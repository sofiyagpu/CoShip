import { useEffect, useRef, useState } from 'react';
import 'lenis/dist/lenis.css';

const palette = ['#0f7b54', '#1fa971', '#4cc38a', '#2bb3a3', '#8fd06f', '#0b5c3f', '#5fb8e8'];

/** Effects live only on the welcome screen and release their resources on sign-in. */
export function WelcomeMotion() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(preference.matches);
    preference.addEventListener('change', changed);
    return () => preference.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    if (reduced || !canvasHost.current) return;
    const root = canvasHost.current.closest('.welcome-page');
    if (!root) return;
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([import('gsap'), import('lenis')])
      .then(([{ gsap }, { default: Lenis }]) => {
        if (disposed) return;
        const scrolling = new Lenis({
          autoRaf: true,
          anchors: true,
          duration: 0.85,
          smoothWheel: true,
        });
        const context = gsap.context(() => {
          gsap.fromTo(
            '.welcome-mark, .welcome-content h1, .welcome-content .button',
            { y: 24, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: 0.9,
              stagger: 0.1,
              ease: 'power3.out',
              clearProps: 'transform,opacity',
            },
          );
        }, root);
        cleanup = () => {
          context.revert();
          scrolling.destroy();
        };
      })
      .catch(() => {
        /* Native scrolling and visible content remain available. */
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [reduced]);

  useEffect(() => {
    if (paused || reduced || !canvasHost.current) return;
    const host = canvasHost.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    host.append(canvas);
    let w = 0,
      h = 0,
      reach = 0,
      frame = 0,
      visible = true,
      dustColor = '#80868b';
    let dust: { x: number; y: number }[] = [];
    let dashes: { ring: number; angle: number; speed: number; len: number; color: string }[] = [];
    const center = { x: 0, y: 0 },
      target = { x: 0, y: 0 };
    const readColors = () => {
      dustColor = getComputedStyle(host).getPropertyValue('--faint').trim() || dustColor;
    };
    // Grey dust everywhere, coloured dashes orbiting a vortex that trails the pointer.
    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      w = host.clientWidth;
      h = host.clientHeight;
      reach = Math.max(w, h) * 0.5;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dust = Array.from({ length: Math.round((w * h) / 2400) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
      }));
      dashes = Array.from({ length: 340 }, (_, i) => {
        const ring = 40 + Math.random() ** 0.8 * reach;
        return {
          ring,
          angle: Math.random() * Math.PI * 2,
          speed: (0.0008 + Math.random() * 0.0016) * (120 / (ring * 0.25 + 60)),
          len: 3 + Math.random() * 5,
          color: palette[i % palette.length],
        };
      });
      center.x = target.x = w * 0.25;
      center.y = target.y = h * 0.42;
      readColors();
    };
    const draw = () => {
      center.x += (target.x - center.x) * 0.035;
      center.y += (target.y - center.y) * 0.035;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = dustColor;
      for (const d of dust) ctx.fillRect(d.x, d.y, 1.2, 1.2);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (const p of dashes) {
        p.angle += p.speed;
        const dx = Math.cos(p.angle),
          dy = Math.sin(p.angle);
        const x = center.x + dx * p.ring,
          y = center.y + dy * p.ring * 0.85;
        if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
        ctx.globalAlpha = 0.15 + 0.85 * (1 - p.ring / reach);
        ctx.strokeStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx * p.len, y + dy * p.len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      frame = visible && !document.hidden ? requestAnimationFrame(draw) : 0;
    };
    const resume = () => {
      if (!frame && visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const pointer = (e: PointerEvent) => {
      const box = host.getBoundingClientRect();
      target.x = e.clientX - box.left;
      target.y = e.clientY - box.top;
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    const resized = new ResizeObserver(resize);
    resize();
    resized.observe(host);
    observer.observe(host);
    window.addEventListener('pointermove', pointer);
    window.addEventListener('coship:theme', readColors);
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      observer.disconnect();
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('coship:theme', readColors);
      document.removeEventListener('visibilitychange', resume);
      canvas.remove();
    };
  }, [paused, reduced]);

  return (
    <>
      <div className="welcome-particles" ref={canvasHost} aria-hidden="true" />
      {!reduced && (
        <button
          className="motion-toggle"
          aria-pressed={paused}
          aria-label={paused ? 'Включить анимацию фона' : 'Приостановить анимацию фона'}
          onClick={() => setPaused((value) => !value)}
        >
          <span>{paused ? 'Включить анимацию' : 'Пауза'}</span>
        </button>
      )}
    </>
  );
}
