import { useEffect, useRef, useState } from 'react';
import 'lenis/dist/lenis.css';

const reducedQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)');

/** Effects live only on the welcome screen and release their resources on sign-in. */
export function WelcomeMotion() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => reducedQuery().matches);
  useEffect(() => {
    const preference = reducedQuery();
    const changed = () => setReduced(preference.matches);
    preference.addEventListener('change', changed);
    return () => preference.removeEventListener('change', changed);
  }, []);

  // Smooth scrolling and scroll reveals. Hidden-until-revealed styles only apply under
  // .motion-ok, so content stays visible without JS or with reduced motion.
  useEffect(() => {
    const root = canvasHost.current?.closest('.welcome-page');
    if (reduced || !root) return;
    root.classList.add('motion-ok');
    const reveal = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('revealed');
          reveal.unobserve(entry.target);
        }),
      { threshold: 0.2 },
    );
    root.querySelectorAll('[data-reveal]').forEach((el) => reveal.observe(el));
    let disposed = false;
    let cleanup = () => {};
    void import('lenis')
      .then(({ default: Lenis }) => {
        if (disposed) return;
        const scrolling = new Lenis({ autoRaf: true, anchors: true, duration: 0.85 });
        cleanup = () => scrolling.destroy();
      })
      .catch(() => {
        /* Native scrolling remains available. */
      });
    return () => {
      disposed = true;
      cleanup();
      reveal.disconnect();
      root.classList.remove('motion-ok');
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
      frame = 0,
      visible = true,
      lastMove = -Infinity,
      dark = false;
    let dots: { x: number; y: number; seed: number }[] = [];
    const center = { x: 0, y: 0 },
      target = { x: 0, y: 0 },
      started = performance.now();
    const readTheme = () => {
      dark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
    };
    // A jittered lattice of particles; a breathing ring around the pointer lights them up.
    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      w = host.clientWidth;
      h = host.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const step = w < 700 ? 24 : 30;
      dots = [];
      for (let y = step / 2; y < h; y += step)
        for (let x = step / 2; x < w; x += step)
          dots.push({
            x: x + (Math.random() - 0.5) * step * 0.8,
            y: y + (Math.random() - 0.5) * step * 0.8,
            seed: Math.random() * Math.PI * 2,
          });
      if (!frame) {
        center.x = target.x = w / 2;
        center.y = target.y = h * 0.45;
      }
      readTheme();
    };
    const draw = (now: number) => {
      const t = (now - started) / 1000;
      if (now - lastMove > 2500) {
        target.x = w / 2 + Math.cos(t * 0.23) * w * 0.2;
        target.y = h * 0.45 + Math.sin(t * 0.31) * h * 0.14;
      }
      center.x += (target.x - center.x) * 0.045;
      center.y += (target.y - center.y) * 0.045;
      // Intro: the ring bursts out of the centre over the first 1.8 s.
      const intro = 1 - (1 - Math.min(t / 1.8, 1)) ** 3;
      const radius = intro * (Math.min(w, h) * 0.34 + Math.sin(t * 0.9) * 22);
      const width = 52 + 20 * Math.sin(t * 0.55 + 1) + (1 - intro) * 60;
      const light = dark ? 66 : 54;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      for (const d of dots) {
        const dx = d.x - center.x,
          dy = d.y - center.y,
          dist = Math.hypot(dx, dy) || 1;
        const ring = Math.exp(-(((dist - radius) / width) ** 2));
        if (ring < 0.08) continue;
        const ux = dx / dist,
          uy = dy / dist;
        const push = ring * (10 + Math.sin(t * 2.2 + d.seed) * 5);
        const x = d.x + ux * push,
          y = d.y + uy * push,
          half = (1 + ring * 4) / 2;
        const hue = 212 + 22 * Math.sin(Math.atan2(dy, dx) * 2 + t * 0.5) + 10 * Math.sin(d.seed);
        ctx.globalAlpha = Math.min(0.9, ring * 1.2);
        ctx.lineWidth = 1.5 + ring;
        ctx.strokeStyle = `hsl(${hue} 92% ${light}%)`;
        ctx.beginPath();
        ctx.moveTo(x - ux * half, y - uy * half);
        ctx.lineTo(x + ux * half, y + uy * half);
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
      lastMove = performance.now();
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
    window.addEventListener('coship:theme', readTheme);
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      observer.disconnect();
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('coship:theme', readTheme);
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

/** Types the headline letter by letter behind a gradient caret; layout is reserved up front. */
export function TypedHeading({ id, text }: { id: string; text: string }) {
  const [reduced] = useState(() => reducedQuery().matches);
  const [count, setCount] = useState(reduced ? text.length : 0);
  const [caret, setCaret] = useState(!reduced);
  useEffect(() => {
    if (reduced) return;
    let typed = 0,
      timer = 0;
    const tick = () => {
      setCount(++typed);
      timer =
        typed < text.length
          ? window.setTimeout(tick, text[typed - 1] === ' ' ? 70 : 28 + Math.random() * 34)
          : window.setTimeout(() => setCaret(false), 350);
    };
    timer = window.setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, [reduced, text]);
  return (
    <h1 id={id}>
      <span className="visually-hidden">{text}</span>
      <span aria-hidden="true">
        {[...text.slice(0, count)].map((char, i) => (
          <span key={i} className="typed-char">
            {char}
          </span>
        ))}
        <span className={`typed-caret ${caret ? '' : 'done'}`} />
        <span className="typed-rest">{text.slice(count)}</span>
      </span>
    </h1>
  );
}
