/** Рисование обложки, титульного листа и страницы аннотации на canvas.
 *  Картинок обложек в системе нет — обложка выводится из названия: ткань
 *  переплёта, латунное тиснение, название шрифтом Fraunces. Отдельно от
 *  three.js, чтобы то же самое могла показать и плоская запасная витрина. */
import { coverPalette } from "@/lib/shelf";

export interface ShelfBook {
  id: number;
  title: string;
  genre: string | null;
  /** Абзацы аннотации или null, если замысла ещё нет. */
  annotation: string[] | null;
  /** Строки титульного листа: подпись → значение. */
  meta: Array<[string, string]>;
  seed: number;
}

export const PAGE_W = 1024;
export const PAGE_H = 1536;

const PAPER = "#ECE4CF";
const INK = "#2A231A";
const INK_MUTED = "#776B58";
const HAIR = "rgba(42, 35, 26, 0.18)";

/** Шрифты должны быть загружены до рисования: canvas не ждёт веб-шрифт и
 *  молча рисует запасным. Кириллица — отдельный кусок шрифта, грузим её. */
export async function loadCoverFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const sample = "Ёё Аа Яя";
  await Promise.all(
    [
      "500 96px Fraunces",
      "italic 400 40px Lora",
      "400 40px Lora",
      "600 30px Inter",
      "400 30px Inter",
    ].map((f) => document.fonts.load(f, sample).catch(() => [])),
  );
}

/** Перенос по словам в заданную ширину. Слово длиннее строки не рвётся. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Детерминированный шум для фактуры ткани — от названия книги. */
function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = PAGE_W;
  c.height = PAGE_H;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas 2d недоступен");
  return [c, ctx];
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

function rule(ctx: CanvasRenderingContext2D, y: number, half: number, color: string) {
  const cx = PAGE_W / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - half, y);
  ctx.lineTo(cx - 22, y);
  ctx.moveTo(cx + 22, y);
  ctx.lineTo(cx + half, y);
  ctx.stroke();
  ctx.fillStyle = color;
  diamond(ctx, cx, y, 9);
}

/** Название крупно, но не больше четырёх строк: кегль уменьшается, пока
 *  не влезет. */
function fitTitle(ctx: CanvasRenderingContext2D, title: string, maxWidth: number, start: number, min: number) {
  for (let size = start; size >= min; size -= 6) {
    ctx.font = `500 ${size}px Fraunces, Georgia, serif`;
    const lines = wrapLines(ctx, title, maxWidth);
    if (lines.length <= 4 && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      return { size, lines };
    }
  }
  ctx.font = `500 ${min}px Fraunces, Georgia, serif`;
  return { size: min, lines: wrapLines(ctx, title, maxWidth).slice(0, 4) };
}

export function drawCover(book: ShelfBook): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const pal = coverPalette(book.seed);
  const rand = rng(book.seed);

  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  // Ткань: мелкие штрихи чуть светлее и темнее основы.
  for (let i = 0; i < 9000; i++) {
    const x = rand() * PAGE_W;
    const y = rand() * PAGE_H;
    ctx.fillStyle = rand() > 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.06)";
    ctx.fillRect(x, y, 2 + rand() * 5, 1);
  }
  // Свет по центру и тень к краям.
  const glow = ctx.createRadialGradient(PAGE_W * 0.55, PAGE_H * 0.4, 80, PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.75);
  glow.addColorStop(0, "rgba(255,255,255,0.10)");
  glow.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  // Шарнир у корешка.
  const hinge = ctx.createLinearGradient(0, 0, 70, 0);
  hinge.addColorStop(0, pal.dark);
  hinge.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hinge;
  ctx.fillRect(0, 0, 70, PAGE_H);

  // Двойная рамка тиснения.
  ctx.strokeStyle = pal.foil;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 4;
  ctx.strokeRect(84, 84, PAGE_W - 168, PAGE_H - 168);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(104, 104, PAGE_W - 208, PAGE_H - 208);
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.foil;
  for (const [x, y] of [
    [84, 84],
    [PAGE_W - 84, 84],
    [84, PAGE_H - 84],
    [PAGE_W - 84, PAGE_H - 84],
  ] as const) {
    diamond(ctx, x, y, 12);
  }

  rule(ctx, 360, 200, pal.foil);

  const { size, lines } = fitTitle(ctx, book.title, PAGE_W - 300, 124, 64);
  const lh = size * 1.12;
  const top = 700 - ((lines.length - 1) * lh) / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = pal.foil;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  lines.forEach((l, i) => ctx.fillText(l, PAGE_W / 2, top + i * lh));
  ctx.shadowColor = "transparent";

  rule(ctx, 1060, 200, pal.foil);

  if (book.genre) {
    ctx.font = "600 30px Inter, system-ui, sans-serif";
    ctx.letterSpacing = "7px";
    ctx.fillStyle = pal.foil;
    ctx.globalAlpha = 0.9;
    const g = wrapLines(ctx, book.genre.toUpperCase(), PAGE_W - 320).slice(0, 2);
    g.forEach((l, i) => ctx.fillText(l, PAGE_W / 2, 1140 + i * 44));
    ctx.globalAlpha = 1;
    ctx.letterSpacing = "0px";
  }
  return c;
}

function paper(ctx: CanvasRenderingContext2D, seed: number, gutterLeft: boolean) {
  const rand = rng(seed ^ 0x9e3779b9);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = "rgba(90,70,40,0.035)";
    ctx.fillRect(rand() * PAGE_W, rand() * PAGE_H, 2, 2);
  }
  // Тень переплёта у корешка — со стороны сгиба.
  const g = gutterLeft
    ? ctx.createLinearGradient(0, 0, 120, 0)
    : ctx.createLinearGradient(PAGE_W, 0, PAGE_W - 120, 0);
  g.addColorStop(0, "rgba(60,45,25,0.28)");
  g.addColorStop(1, "rgba(60,45,25,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
}

/** Левая страница раскрытой книги (изнанка обложки): титульный лист. */
export function drawTitlePage(book: ShelfBook): HTMLCanvasElement {
  const [c, ctx] = canvas();
  paper(ctx, book.seed, false);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const { size, lines } = fitTitle(ctx, book.title, PAGE_W - 260, 96, 56);
  ctx.fillStyle = INK;
  const lh = size * 1.14;
  lines.forEach((l, i) => ctx.fillText(l, PAGE_W / 2, 360 + i * lh));
  let y = 360 + (lines.length - 1) * lh + 80;

  if (book.genre) {
    ctx.font = "italic 400 40px Lora, Georgia, serif";
    ctx.fillStyle = INK_MUTED;
    ctx.fillText(book.genre, PAGE_W / 2, y);
    y += 60;
  }
  rule(ctx, y + 30, 170, "rgba(42,35,26,0.55)");

  y = Math.max(y + 170, 880);
  ctx.textBaseline = "middle";
  for (const [label, value] of book.meta) {
    ctx.strokeStyle = HAIR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(150, y - 46);
    ctx.lineTo(PAGE_W - 150, y - 46);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.font = "400 30px Inter, system-ui, sans-serif";
    ctx.fillStyle = INK_MUTED;
    ctx.fillText(label, 150, y);
    ctx.textAlign = "right";
    ctx.font = "400 36px Lora, Georgia, serif";
    ctx.fillStyle = INK;
    ctx.fillText(value, PAGE_W - 150, y);
    y += 92;
  }
  return c;
}

/** Правая страница: аннотация. Не влезла — обрывается многоточием, полный
 *  текст есть рядом, в тексте для чтения с экрана. */
export function drawAnnotationPage(book: ShelfBook): HTMLCanvasElement {
  const [c, ctx] = canvas();
  paper(ctx, book.seed, true);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "600 28px Inter, system-ui, sans-serif";
  ctx.letterSpacing = "8px";
  ctx.fillStyle = INK_MUTED;
  ctx.fillText("АННОТАЦИЯ", PAGE_W / 2, 190);
  ctx.letterSpacing = "0px";
  rule(ctx, 240, 120, "rgba(42,35,26,0.45)");

  const left = 150;
  const width = PAGE_W - 300;
  const bottom = PAGE_H - 150;
  ctx.textAlign = "left";

  if (!book.annotation) {
    ctx.font = "italic 400 40px Lora, Georgia, serif";
    ctx.fillStyle = INK_MUTED;
    const lines = wrapLines(ctx, "Аннотация появится, когда вы утвердите замысел в Мастерской.", width);
    lines.forEach((l, i) => ctx.fillText(l, left, 400 + i * 62));
    return c;
  }

  ctx.font = "400 40px Lora, Georgia, serif";
  ctx.fillStyle = INK;
  const lh = 62;
  let y = 360;
  outer: for (const para of book.annotation) {
    const lines = wrapLines(ctx, para, width);
    for (let i = 0; i < lines.length; i++) {
      if (y > bottom) break outer;
      const last = y + lh > bottom && (i < lines.length - 1 || para !== book.annotation.at(-1));
      const text = last ? `${lines[i]!.replace(/[.,;:!?…]*$/, "")}…` : lines[i]!;
      ctx.fillText(text, left + (i === 0 ? 48 : 0), y);
      y += lh;
      if (last) break outer;
    }
    y += 26;
  }
  return c;
}
