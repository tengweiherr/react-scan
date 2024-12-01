import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { recalcOutlines } from './outline';

const resizeScheduled = signal(false);

let ctxRef:
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D
  | null = null;
export const getOverlayContext = () => ctxRef;

export function ReactScanOverlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isOffscreenCanvasSupported = 'OffscreenCanvas' in globalThis;
    const offscreenCanvas = isOffscreenCanvasSupported
      ? canvas.transferControlToOffscreen()
      : canvas;

    const context = offscreenCanvas.getContext('2d');
    if (
      !context ||
      !(context instanceof CanvasRenderingContext2D || 'commit' in context)
    ) {
      throw new Error('Failed to get 2D context');
    }
    ctxRef = context;

    const resize = () => {
      const ctx = ctxRef;
      if (!ctx) return;

      const dpi = window.devicePixelRatio || 1;
      ctx.canvas.width = dpi * window.innerWidth;
      ctx.canvas.height = dpi * window.innerHeight;

      if (canvas) {
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
      }

      ctx.resetTransform();
      ctx.scale(dpi, dpi);

      resizeScheduled.value = false;
    };

    resize();

    const handleResize = () => {
      recalcOutlines();
      if (!resizeScheduled.value) {
        resizeScheduled.value = true;
        requestAnimationFrame(resize);
      }
    };

    const handleScroll = () => {
      recalcOutlines();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="react-scan-canvas"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 2147483646,
      }}
      aria-hidden="true"
    />
  );
}
