import { useEffect, useRef } from "react";
import * as THREE from "three";
import { booksPerRow, coverPalette, shelfLayout } from "@/lib/shelf";
import {
  drawAnnotationPage,
  drawCover,
  drawTitlePage,
  loadCoverFonts,
  type ShelfBook,
} from "./coverArt";

/** Витрина полки на three.js: книги стоят лицом на подставке под тёплой
 *  лампой; выбранная выезжает к камере и раскрывается — слева титульный
 *  лист, справа аннотация. Сцена императивная: React отдаёт ей данные и
 *  выбор через ссылки, она сама рисует кадры. */

interface Props {
  books: ShelfBook[];
  /** Раскрытая книга или null. */
  openId: number | null;
  /** Подсвеченная с клавиатуры книга (индекс в books) или -1. */
  focusIndex: number;
  onPick: (id: number | null) => void;
  onHover: (index: number) => void;
  /** WebGL не завёлся — родитель покажет плоскую витрину. */
  onFail: () => void;
  reducedMotion: boolean;
}

const W = 1;
const H = 1.5;
const D = 0.16;
const STEP = 1.45;
const ROW = 2.1;
const BOARD = 0.022;
/** Страница (торец блока и лист на изнанке обложки): чуть меньше обложки. */
const PAGE_W3 = W - 0.04;
const PAGE_H3 = H - 0.05;
/** Отступ страницы от корешка. */
const PAGE_X0 = 0.01;

interface BookRig {
  book: ShelfBook;
  group: THREE.Group;
  pivot: THREE.Object3D;
  block: THREE.Mesh;
  back: THREE.Mesh;
  inside: THREE.MeshStandardMaterial;
  front: THREE.MeshStandardMaterial;
  hover: number;
  open: number;
  slot: THREE.Vector3;
  pagesReady: boolean;
}

function texture(c: HTMLCanvasElement, renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function woodTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "#5a3f28");
  g.addColorStop(1, "#3b2819");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 128);
  let s = 7;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(20,10,4,${0.08 + rand() * 0.12})`;
    ctx.lineWidth = 1 + rand() * 2;
    const y = rand() * 128;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 64) ctx.lineTo(x, y + Math.sin(x / 90 + i) * 3);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function pageEdgeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#E4DAC2";
  ctx.fillRect(0, 0, 64, 256);
  for (let x = 0; x < 64; x += 3) {
    ctx.fillStyle = `rgba(120,100,70,${0.08 + ((x * 7) % 5) * 0.03})`;
    ctx.fillRect(x, 0, 1, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export default function ShowcaseScene(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  // Сцена переживает смену выбора; пересобирается только при смене книг.
  const booksKey = props.books.map((b) => `${b.id}:${b.title}:${b.genre ?? ""}`).join("|");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      propsRef.current.onFail();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const disposables: Array<{ dispose: () => void }> = [];
    const keep = <T extends { dispose: () => void }>(x: T): T => {
      disposables.push(x);
      return x;
    };

    // Свет: тёплая лампа сверху-спереди, холодный фон ночи, слабая подсветка.
    scene.add(new THREE.HemisphereLight(0x46557a, 0x0a0c12, 0.55));
    const lamp = new THREE.SpotLight(0xffd29a, 5.2, 0, 0.62, 0.75, 0);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.radius = 4;
    scene.add(lamp, lamp.target);
    const fill = new THREE.DirectionalLight(0x9fb4e0, 0.35);
    fill.position.set(-4, 2, 6);
    scene.add(fill);
    // Свет для чтения: зажигается вместе с раскрытием, иначе разворот у
    // камеры выходит из пятна лампы и бумага сереет.
    const reading = new THREE.DirectionalLight(0xffe2b8, 0);
    scene.add(reading, reading.target);

    // Стена за полкой ловит пятно света лампы.
    const wall = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(60, 40)),
      keep(new THREE.MeshStandardMaterial({ color: 0x171c29, roughness: 1 })),
    );
    wall.position.z = -0.45;
    wall.receiveShadow = true;
    scene.add(wall);

    const wood = keep(woodTexture());
    const woodMat = keep(new THREE.MeshStandardMaterial({ map: wood, roughness: 0.8 }));
    const edgeTex = keep(pageEdgeTexture());
    const edgeMat = keep(new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.95 }));
    const paperMat = keep(new THREE.MeshStandardMaterial({ color: 0xece4cf, roughness: 0.95 }));

    // Затемнение позади раскрытой книги.
    const dimMat = keep(
      new THREE.MeshBasicMaterial({ color: 0x06070b, transparent: true, opacity: 0, depthWrite: false }),
    );
    const dim = new THREE.Mesh(keep(new THREE.PlaneGeometry(200, 200)), dimMat);
    dim.renderOrder = 5;
    scene.add(dim);

    const coverGeo = keep(new THREE.BoxGeometry(W, H, BOARD));
    const spineGeo = keep(new THREE.BoxGeometry(BOARD * 1.4, H, D));
    const blockGeo = keep(new THREE.BoxGeometry(PAGE_W3, PAGE_H3, D - BOARD * 2));
    // Левая страница разворота — отдельный лист того же размера, что и
    // правая (торец блока). Прежде ею служила изнанка обложки, а обложка
    // больше блока страниц — разворот выходил кривым.
    const leafGeo = keep(new THREE.PlaneGeometry(PAGE_W3, PAGE_H3));

    const rigs: BookRig[] = [];
    const planks: THREE.Mesh[] = [];
    const pickables: THREE.Object3D[] = [];

    for (const book of propsRef.current.books) {
      const pal = coverPalette(book.seed);
      const cloth = keep(new THREE.MeshStandardMaterial({ color: pal.base, roughness: 0.85 }));
      const coverTex = keep(texture(drawCover(book), renderer));
      const front = keep(new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.72 }));
      const inside = keep(paperMat.clone());
      const blockFront = keep(paperMat.clone());

      const group = new THREE.Group();
      // Начало координат книги — низ корешка: книга стоит на полке и
      // раскрывается вокруг корешка.
      const pivot = new THREE.Object3D();
      pivot.position.set(0, 0, D / 2 - BOARD / 2);
      const cover = new THREE.Mesh(coverGeo, [cloth, cloth, cloth, cloth, front, cloth]);
      cover.position.set(W / 2, H / 2, 0);
      // Лист лежит на изнанке обложки. После поворота обложки на π он
      // зеркально встаёт рядом с правой страницей: та же ширина, высота,
      // тот же отступ от корешка.
      const leaf = new THREE.Mesh(leafGeo, inside);
      leaf.rotation.y = Math.PI;
      leaf.position.set(PAGE_X0 + PAGE_W3 / 2, H / 2, -(BOARD / 2 + 0.001));
      pivot.add(cover, leaf);
      const back = new THREE.Mesh(coverGeo, cloth);
      back.position.set(W / 2, H / 2, -D / 2 + BOARD / 2);
      const spine = new THREE.Mesh(spineGeo, cloth);
      spine.position.set(0, H / 2, 0);
      const block = new THREE.Mesh(blockGeo, [edgeMat, cloth, edgeMat, edgeMat, blockFront, paperMat]);
      block.position.set(PAGE_X0 + PAGE_W3 / 2, H / 2, 0);
      for (const m of [cover, leaf, back, spine, block]) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.bookId = book.id;
        pickables.push(m);
      }
      group.add(pivot, back, spine, block);
      scene.add(group);
      rigs.push({
        book,
        group,
        pivot,
        block,
        back,
        inside,
        front: blockFront,
        hover: 0,
        open: 0,
        slot: new THREE.Vector3(),
        pagesReady: false,
      });
    }

    let openZ = 2;
    let openY = 0;

    function layout() {
      const w = host!.clientWidth || 1;
      const h = host!.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      const perRow = booksPerRow(rigs.length, camera.aspect);
      const slots = shelfLayout(rigs.length, perRow, STEP, ROW);
      const rows = Math.max(1, Math.ceil(rigs.length / perRow));

      // Полки пересобираются при смене ширины окна: число книг в ряд
      // зависит от пропорций кадра.
      for (const p of planks) {
        scene.remove(p);
        p.geometry.dispose();
        for (const c of p.children) (c as THREE.Mesh).geometry.dispose();
      }
      planks.length = 0;
      for (let r = 0; r < rows; r++) {
        const y = ((rows - 1) / 2 - r) * ROW - H / 2;
        const plank = new THREE.Mesh(new THREE.BoxGeometry(perRow * STEP + 0.9, 0.09, 0.8), woodMat);
        plank.position.set(0, y - 0.045, 0.02);
        plank.receiveShadow = true;
        plank.castShadow = true;
        // Бортик спереди — книги «стоят» на витрине, а не висят.
        const lip = new THREE.Mesh(new THREE.BoxGeometry(perRow * STEP + 0.9, 0.07, 0.03), woodMat);
        lip.position.set(0, 0.06, 0.4);
        plank.add(lip);
        scene.add(plank);
        planks.push(plank);
      }
      slots.forEach((s, i) => {
        rigs[i]!.slot.set(s.x - W / 2, s.y - H / 2, 0);
      });

      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const spanW = perRow * STEP + 0.6;
      const spanH = rows * ROW + 0.2;
      const dist = Math.max(spanH / 2 / tan, spanW / 2 / (tan * camera.aspect)) * 1.12;
      camera.position.set(0, 0.15, dist);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      lamp.position.set(0.6, spanH / 2 + 3.2, 4.2);
      lamp.target.position.set(0, 0, 0);

      // Раскрытый разворот занимает ~70% ширины и ~80% высоты кадра.
      const dOpen = Math.max(H / (0.8 * 2 * tan), (2 * W) / (0.7 * 2 * tan * camera.aspect));
      openZ = camera.position.z - dOpen;
      openY = camera.position.y - H / 2;
      dim.position.set(0, 0, openZ - 0.3);
      reading.position.set(0.8, camera.position.y + 2.2, camera.position.z + 1);
      reading.target.position.set(0, camera.position.y, openZ);
    }

    const ro = new ResizeObserver(layout);
    ro.observe(host);
    layout();

    // Страницы разворота рисуются при первом раскрытии: их немного, а на
    // полке из тридцати книг это ещё 60 больших текстур впустую.
    function ensurePages(rig: BookRig) {
      if (rig.pagesReady) return;
      rig.pagesReady = true;
      const title = keep(texture(drawTitlePage(rig.book), renderer));
      const annotation = keep(texture(drawAnnotationPage(rig.book), renderer));
      rig.inside.map = title;
      rig.inside.color.set(0xffffff);
      rig.inside.needsUpdate = true;
      rig.front.map = annotation;
      rig.front.color.set(0xffffff);
      rig.front.needsUpdate = true;
    }

    // Шрифты догружаются — обложки перерисовываются уже ими.
    let fontsAlive = true;
    void loadCoverFonts().then(() => {
      if (!fontsAlive) return;
      for (const rig of rigs) {
        const mat = (rig.pivot.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial[];
        const old = mat[4]!.map;
        mat[4]!.map = keep(texture(drawCover(rig.book), renderer));
        mat[4]!.needsUpdate = true;
        old?.dispose();
        if (rig.pagesReady) {
          rig.pagesReady = false;
          ensurePages(rig);
        }
      }
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerHover = -1;

    function hit(e: PointerEvent | MouseEvent): number | null {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const found = raycaster.intersectObjects(pickables, false)[0];
      return found ? (found.object.userData.bookId as number) : null;
    }

    function onMove(e: PointerEvent) {
      if (propsRef.current.openId !== null) {
        renderer.domElement.style.cursor = "default";
        return;
      }
      const id = hit(e);
      const idx = id === null ? -1 : rigs.findIndex((r) => r.book.id === id);
      renderer.domElement.style.cursor = idx >= 0 ? "pointer" : "default";
      if (idx !== pointerHover) {
        pointerHover = idx;
        propsRef.current.onHover(idx);
      }
    }
    function onClick(e: MouseEvent) {
      const { openId, onPick } = propsRef.current;
      const id = hit(e);
      if (openId !== null) {
        // Клик мимо раскрытой книги закрывает её.
        if (id !== openId) onPick(null);
        return;
      }
      if (id !== null) onPick(id);
    }
    function onLeave() {
      pointerHover = -1;
      propsRef.current.onHover(-1);
    }
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    const LEAN = -0.06;
    const tmpClosed = new THREE.Vector3();
    const tmpOpen = new THREE.Vector3();
    let last = performance.now();
    let raf = 0;

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { openId, focusIndex, reducedMotion } = propsRef.current;
      const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
      let maxOpen = 0;

      rigs.forEach((rig, i) => {
        const wantOpen = rig.book.id === openId ? 1 : 0;
        const wantHover = openId === null && i === focusIndex ? 1 : 0;
        if (wantOpen) ensurePages(rig);
        rig.open += (wantOpen - rig.open) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2));
        rig.hover += (wantHover - rig.hover) * k;
        if (Math.abs(rig.open - wantOpen) < 0.0005) rig.open = wantOpen;
        maxOpen = Math.max(maxOpen, rig.open);

        const fly = ease(clamp01(rig.open / 0.55));
        const unfold = ease(clamp01((rig.open - 0.35) / 0.65));
        tmpClosed.copy(rig.slot);
        tmpClosed.y += 0.07 * rig.hover;
        tmpClosed.z += 0.18 * rig.hover;
        tmpOpen.set(0, openY, openZ);
        rig.group.position.lerpVectors(tmpClosed, tmpOpen, fly);
        rig.group.rotation.x = LEAN * (1 - fly) + 0.04 * rig.hover * (1 - fly);
        rig.group.rotation.y = -0.05 * rig.hover * (1 - fly);
        // Ровно π: разворот плоский, обе страницы в одной плоскости.
        rig.pivot.rotation.y = -Math.PI * unfold;
        // Блок подаётся вперёд на толщину обложки: правая страница встаёт
        // в плоскость левой, и перспектива не делает одну из них крупнее.
        rig.block.position.z = (BOARD + 0.001) * unfold;
        // Задняя крышка встаёт прямо за правую страницу — её кант виден так
        // же, как кант обложки вокруг левой: разворот симметричен.
        rig.back.position.z = THREE.MathUtils.lerp(-D / 2 + BOARD / 2, D / 2 - BOARD / 2 - 0.003, unfold);
        // Подсвеченная книга чуть теплеет — видно, на какой вы стоите.
        const coverMat = (rig.pivot.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial[];
        coverMat[4]!.emissive.setRGB(0.09 * rig.hover, 0.06 * rig.hover, 0.02 * rig.hover);
      });

      dimMat.opacity = 0.62 * ease(clamp01(maxOpen * 1.4));
      reading.intensity = 2.4 * ease(clamp01((maxOpen - 0.3) / 0.7));
      dim.visible = dimMat.opacity > 0.001;
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      fontsAlive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      for (const p of planks) {
        p.geometry.dispose();
        for (const c of p.children) (c as THREE.Mesh).geometry.dispose();
      }
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // Пересборка только при смене набора книг; выбор и подсветка идут через ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booksKey]);

  return <div ref={hostRef} className="showcase-canvas" aria-hidden="true" />;
}
