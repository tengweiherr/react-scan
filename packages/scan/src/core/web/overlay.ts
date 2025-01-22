import { recalcOutlines } from '@web-utils/outline';
import { outlineWorker } from '@web-utils/outline-worker';

export const initReactScanOverlay = (
  root?: HTMLElement,
  customStyle?: {
    position?: string;
    top?: string;
    left?: string;
    width?: string;
    height?: string;
    pointerEvents?: string;
    zIndex?: string;

  },
) => {
  const container = root ?? document.getElementById('react-scan-root');
  const shadow = container?.shadowRoot;

  if (!shadow) {
    return null;
  }

  const overlayElement = document.createElement('canvas');
  overlayElement.id = 'react-scan-overlay';

  overlayElement.style.position = customStyle?.position ?? 'fixed';
  overlayElement.style.top = customStyle?.top ?? '0';
  overlayElement.style.left = customStyle?.left ?? '0';
  overlayElement.style.width = customStyle?.width ?? '100vw';
  overlayElement.style.height = customStyle?.height ?? '100vh';
  overlayElement.style.pointerEvents = customStyle?.pointerEvents ?? 'none';
  overlayElement.style.zIndex = customStyle?.zIndex ?? '2147483646';

  overlayElement.setAttribute('aria-hidden', 'true');

  shadow.appendChild(overlayElement);

  const dpi = window.devicePixelRatio || 1;
  overlayElement.width = dpi * window.innerWidth;
  overlayElement.height = dpi * window.innerHeight;

  let resizeScheduled = false;

  const updateCanvasSize = () => {
    const dpi = window.devicePixelRatio || 1;

    outlineWorker
      .call({
        type: 'resize',
        payload: {
          width: dpi * window.innerWidth,
          height: dpi * window.innerHeight,
          dpi,
        },
      })
      .then(
        () => {
          resizeScheduled = false;
        },
        () => {
          resizeScheduled = false;
        },
      );
  };

  window.addEventListener('resize', () => {
    recalcOutlines();

    if (!resizeScheduled) {
      resizeScheduled = true;
      updateCanvasSize();
    }
  });

  window.addEventListener('scroll', () => {
    recalcOutlines();
  });

  outlineWorker.sync = !('OffscreenCanvas' in window);

  const offscreen = outlineWorker.sync
    ? (overlayElement as unknown as OffscreenCanvas)
    : overlayElement.transferControlToOffscreen();

  outlineWorker
    .call(
      {
        type: 'set-canvas',
        payload: offscreen,
      },
      {
        transfer: [offscreen],
      },
    )
    .catch(console.error);

  updateCanvasSize();

  return offscreen;
};
