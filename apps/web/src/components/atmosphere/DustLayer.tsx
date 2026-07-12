import { useEffect, useRef } from "react";
import type { AtmosphereMode } from "@/lib/useAtmosphere";

/** Пылинки видны только в полной атмосфере и не на странице главы
    (бережём ввод в TipTap). */
export function shouldShowDust(mode: AtmosphereMode, routeName: string): boolean {
  return mode === "full" && routeName !== "chapter";
}

const COUNT = 28;

/** Ленивая канва с пылинками в луче света. rAF-цикл, пауза при скрытой вкладке. */
export function DustLayer() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const dust = Array.from({ length: COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.4,
      vx: (Math.random() - 0.5) * 0.00012,
      vy: 0.00003 + Math.random() * 0.00008,
      ph: Math.random() * Math.PI * 2,
    }));

    let raf = 0;
    let running = true;
    const tick = (t: number) => {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of dust) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y > 1.02) {
          p.y = -0.02;
          p.x = Math.random();
        }
        if (p.x > 1.02) p.x = -0.02;
        else if (p.x < -0.02) p.x = 1.02;
        const alpha = 0.1 + 0.08 * Math.sin(t / 1400 + p.ph);
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, p.r * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232, 182, 92, ${alpha.toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onVisibility = () => {
      const visible = !document.hidden;
      if (visible && !running) {
        running = true;
        raf = requestAnimationFrame(tick);
      } else if (!visible) {
        running = false;
        cancelAnimationFrame(raf);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="dust-layer" aria-hidden="true" />;
}
