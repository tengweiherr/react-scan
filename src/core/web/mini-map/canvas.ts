import { ReactScanInternals, type Internals } from '../../index';

const MINIMAP_HEIGHT = 400;
const MINIMAP_WIDTH = 300;
const MINIMAP_CANVAS_ID = 'react-scan-minimap-canvas';

const getVisibleBoundsRelativeToContainer = (element: HTMLElement): DOMRect => {
  // this is wrong, we need a way to arbitrarily calculate the range of visible pixels
  // given in the viewport or blocked by a scroll container
  // maybe helpful? https://stackoverflow.com/questions/704758/how-do-i-check-if-an-element-is-really-visible-with-javascript
  // https://stackoverflow.com/questions/5353934/check-if-element-is-visible-on-screen
  const elementRect = element.getBoundingClientRect();
  const viewportRect = new DOMRect(0, 0, window.innerWidth, window.innerHeight);

  const x1 = Math.max(elementRect.left, viewportRect.left);
  const y1 = Math.max(elementRect.top, viewportRect.top);
  const x2 = Math.min(elementRect.right, viewportRect.right);
  const y2 = Math.min(elementRect.bottom, viewportRect.bottom);

  const width = x2 - x1;
  const height = y2 - y1;

  return new DOMRect(x1, y1, width, height);
};

const hasOverflowChildren = (element: HTMLElement): boolean => {
  // todo
  return true;
};

const drawMinimapInsideViewportWindow = (
  ctx: CanvasRenderingContext2D,
  minimap: {
    topLeft: [number, number];
    bottomRight: [number, number];
    scaleFn: (x: number, y: number) => [number, number];
  },
  element: HTMLElement,
) => {
  const visibleBounds = getVisibleBoundsRelativeToContainer(element);

  // a little ugly, but from world, to canvas
  const [x1, y1] = minimap.scaleFn(visibleBounds.left, visibleBounds.top);
  const [x2, y2] = minimap.scaleFn(visibleBounds.right, visibleBounds.bottom);

  const width = x2 - x1;
  const height = y2 - y1;

  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.strokeRect(x1, y1, width, height);
};

const drawMinimap = (
  ctx: CanvasRenderingContext2D,
  minimap: {
    topLeft: [number, number];
    bottomRight: [number, number];
    scaleFn: (x: number, y: number) => [number, number];
  },
  element: HTMLElement,
) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  drawChildren(element, 20, ctx, minimap.scaleFn);
};

const drawChildren = (
  element: HTMLElement,
  depth = 20,
  ctx: CanvasRenderingContext2D,
  scaleFn: (x: number, y: number) => [number, number],
) => {
  if (depth === 0) return;

  const rect = element.getBoundingClientRect();

  const [x1, y1] = scaleFn(rect.left, rect.top);
  const [x2, y2] = scaleFn(rect.right, rect.bottom);

  const width = x2 - x1;
  const height = y2 - y1;

  ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x1, y1, width, height);

  const children = Array.from(element.children) as HTMLElement[];
  for (const child of children) {
    drawChildren(child, depth - 1, ctx, scaleFn);
  }
};

export const createMinimapCanvas = () => {
  if (typeof window === 'undefined') return;

  let canvas = document.getElementById(
    MINIMAP_CANVAS_ID,
  ) as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = MINIMAP_CANVAS_ID;
    canvas.width = MINIMAP_WIDTH;
    canvas.height = MINIMAP_HEIGHT;
    canvas.style.cssText = `
      position: fixed;
      right: 24px;
      top: 24px; /* Positioning from top */
      pointer-events: none;
      z-index: 2147483646;
      background: rgba(0, 0, 0, 0.8);
      border-radius: 4px;
    `;
    document.documentElement.appendChild(canvas);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const unsubscribeFns: Partial<
    Record<Internals['inspectState']['kind'], () => void>
  > = {};

  const unsubscribeAll = () => {
    Object.values(unsubscribeFns).forEach((unSub) => unSub?.());
  };

  ReactScanInternals.subscribeMultiple(['inspectState'], (store: Internals) => {
    unsubscribeAll();

    const unSub = (() => {
      const inspectState = store.inspectState;

      switch (inspectState.kind) {
        case 'focused': {
          const element = inspectState.focusedDomElement;

          // todo: hiding logic

          const contentRect = element.getBoundingClientRect();
          const contentWidth = Math.max(element.scrollWidth, contentRect.width);
          const contentHeight = Math.max(
            element.scrollHeight,
            contentRect.height,
          );

          const scaleX = MINIMAP_WIDTH / contentWidth;
          const scaleY = MINIMAP_HEIGHT / contentHeight;
          const scale = Math.min(scaleX, scaleY);

          const toCanvasCoordinates = (
            x: number,
            y: number,
          ): [number, number] => {
            const relativeX = x - contentRect.left + element.scrollLeft;
            const relativeY = y - contentRect.top + element.scrollTop;

            return [relativeX * scale, relativeY * scale];
          };

          const minimap: {
            topLeft: [number, number];
            bottomRight: [number, number];
            scaleFn: (x: number, y: number) => [number, number];
          } = {
            topLeft: [contentRect.left, contentRect.top],
            bottomRight: [contentRect.right, contentRect.bottom],
            scaleFn: toCanvasCoordinates,
          };

          let animationFrameId: number;

          const draw = () => {
            drawMinimap(ctx, minimap, element);
            drawMinimapInsideViewportWindow(ctx, minimap, element);

            animationFrameId = requestAnimationFrame(draw);
          };

          draw();

          return () => {
            cancelAnimationFrame(animationFrameId);
            // canvas.style.display = 'none';
          };
        }
        default: {
          // canvas.style.display = 'none';
          return;
        }
      }
    })();

    if (unSub) {
      unsubscribeFns[store.inspectState.kind] = unSub;
    }
  });

  return () => {
    unsubscribeAll();
    canvas.parentNode?.removeChild(canvas);
  };
};
