import { useEffect, useRef, useState } from 'react';
import 'lenis/dist/lenis.css';

type Effect = { destroy: () => void };

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
            '.welcome-eyebrow, .welcome-content h1, .welcome-description, .welcome-access, .welcome-scroll',
            { y: 18, opacity: 0.35 },
            {
              y: 0,
              opacity: 1,
              duration: 0.75,
              stagger: 0.07,
              ease: 'power2.out',
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
    let disposed = false;
    let visible = true;
    let effect: Effect | undefined;
    let cleanup = () => {};
    void Promise.all([import('three'), import('vanta/src/vanta.waves.js')])
      .then(([THREE, { default: waves }]) => {
        if (disposed) return;
        const destroy = () => {
          effect?.destroy();
          effect = undefined;
        };
        const update = () => {
          if (disposed || document.hidden || !visible) {
            destroy();
            return;
          }
          if (!effect) {
            try {
              effect = waves({
                el: host,
                THREE,
                mouseControls: false,
                touchControls: false,
                gyroControls: false,
                minHeight: 200,
                minWidth: 200,
                scale: 2,
                scaleMobile: 3,
                color: 0xc9d6ff,
                shininess: 40,
                waveHeight: 12,
                waveSpeed: 0.32,
                zoom: 0.86,
              });
            } catch {
              destroy();
            }
          }
        };
        const observer = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          update();
        });
        observer.observe(host);
        document.addEventListener('visibilitychange', update);
        update();
        cleanup = () => {
          observer.disconnect();
          document.removeEventListener('visibilitychange', update);
          destroy();
        };
      })
      .catch(() => {
        /* CSS background covers unavailable WebGL or failed lazy chunks. */
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [paused, reduced]);

  return (
    <>
      <div className="welcome-vanta" ref={canvasHost} aria-hidden="true" />
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
