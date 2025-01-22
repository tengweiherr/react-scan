// todos

import {
  applyLabelTransform,
  batchGetBoundingRects,
  flushOutlines,
  getBoundingRect,
  getIsOffscreen,
  getOverlapArea,
  measureTextCached,
  mergeOverlappingLabels,
  Outline,
  OutlineLabel,
  pickColorClosestToStartStage,
} from '@web-utils/outline';
import { OutlineKey } from 'src/core';
import { ReactScanPayload } from 'src/core/monitor/session-replay/record';

// copy activate outline exactly

// goal is to map the input datastructure what to schedueld outlines looks
// like exactly

/**
 * then we have a new scheduled outlines datastructure
 *
 *
 * that datastructure will be plopped into the activateOutline function
 *
 *
 * then we just reply fiber alternate stuff with the actual reference
 *
 *
 * we collect the dom nodes for the scheduled outlines first
 *
 *
 * then we simply just use exact naming and swap
 *
 *
 * then we chop the properties we don't need
 *
 *
 * then later we can optimize for the use case if some things aren't needed
 */

type FiberId = number;

type ComponentName = string;
export interface ReplayOutline {
  timestamp: number;
  domNodeId: number;
  /** Aggregated render info */ // TODO: Flatten AggregatedRender into Outline to avoid re-creating objects
  // this render is useless when in active outlines (confirm this rob)
  aggregatedRender: ReplayAggregatedRender; // maybe we should set this to null when its useless

  /* Active Info- we re-use the Outline object to avoid over-allocing objects, which is why we have a singular aggregatedRender and collection of it (groupedAggregatedRender) */
  alpha: number | null;
  totalFrames: number | null;
  /*
    - Invariant: This scales at a rate of O(unique components rendered at the same (x,y) coordinates)
    - renders with the same x/y position but different fibers will be a different fiber -> aggregated render entry.
  */
  groupedAggregatedRender: Map<FiberId, ReplayAggregatedRender> | null;

  /* Rects for interpolation */
  current: DOMRect | null;
  target: DOMRect | null;
  /* This value is computed before the full rendered text is shown, so its only considered an estimate */
  estimatedTextWidth: number | null; // todo: estimated is stupid just make it the actual
}
export interface ReplayAggregatedRender {
  name: ComponentName;
  frame: number | null;
  // phase: Set<'mount' | 'update' | 'unmount'>;
  time: number | null; // maybe...
  aggregatedCount: number;
  // forget: boolean;
  // changes: AggregatedChange;
  // unnecessary: boolean | null;
  // didCommit: boolean;
  // fps: number;

  computedKey: OutlineKey | null;
  computedCurrent: DOMRect | null; // reference to dom rect to copy over to new outline made at new position
}

const MAX_FRAME = 45;
type ScheduledReplayOutlines = Map<FiberId, ReplayOutline>;

// const payloadToScheduledReplayOutlines = (
//   payload: ReactScanPayload,
//   replayer: {
//     getMirror: () => { getNode: (nodeId: number) => HTMLElement | null };
//   },
// ): ScheduledReplayOutlines => {
//   const scheduledReplayOutlines = new Map<FiberId, ReplayOutline>();

//   for (const event of payload) {
//     const domNode = replayer.getMirror().getNode(event.rrwebDomId);
//     if (!domNode) {
//       continue;
//     }
//     scheduledReplayOutlines.set(event.fiberId, {
//       aggregatedRender: {
//         aggregatedCount: event.renderCount,
//         computedCurrent: null,
//         computedKey: null,
//         frame: 45,
//         name: event.componentName,
//         time: null,
//       },
//       alpha: null,
//       groupedAggregatedRender: null,
//       target: null,
//       current: null,
//       totalFrames: null,
//       estimatedTextWidth: null,
//       domNode,
//     });
//   }

//   return scheduledReplayOutlines;
// };

// const activateOutlines = async (scheduledOutlines: ScheduledReplayOutlines) => {
// };

/**
 *
 * now we can transform the payload into scheduled, and scheduled into active
 *
 *
 * now we should make this all a plugin so we can actually access the replayer
 *
 *
 * there will need to be an interval etc all globals tied to the plugin, not the global scope anymore
 *
 *
 * so we init on the plugin, and replay like a boss
 */
import { EventType, eventWithTime } from '@rrweb/types';
import { ReplayPlugin } from 'rrweb/typings/types';
import { ReactScanInternals } from '../..';
import { signal } from '@preact/signals';
import { getLabelText } from 'src/core/utils';
import { LRUMap } from '@web-utils/lru';

/**
 * Deep clones an object, skipping non-cloneable values like functions, DOM nodes, etc.
 * @param obj The object to clone
 * @returns A deep clone of the object with non-cloneable values omitted
 */
export const safeDeepClone = <T>(obj: T): T => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle primitive types
  if (typeof obj !== 'object') {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => safeDeepClone(item)) as unknown as T;
  }

  // Handle dates
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  // Create new object of same type
  const clone = Object.create(Object.getPrototypeOf(obj));

  // Clone each property
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      try {
        const val = obj[key];
        // Skip if value is not cloneable (functions, DOM nodes etc)
        if (
          val === null ||
          typeof val !== 'object' ||
          val instanceof Node ||
          typeof val === 'function'
        ) {
          clone[key] = val;
        } else {
          clone[key] = safeDeepClone(val);
        }
      } catch (e) {
        // Skip any values that error during cloning
        clone[key] = obj[key];
      }
    }
  }

  return clone;
};

export interface RRWebPlayer {
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
  getMirror: () => {
    getNode: (id: number) => HTMLElement | null;
  };
  iframe: HTMLIFrameElement;
  // addEventListener: (event: string, handler: Function) => void;
  // removeEventListener: (event: string, handler: Function) => void;
  // getReplayer: () => unknown;
}

/**
 * we should scope all data to this plugin, including the interval
 *
 * then we simply flush to the canvas we are going to make
 */

export class ReactScanReplayPlugin implements ReplayPlugin {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private replayer: RRWebPlayer | null = null;
  private activeOutlines = new Map<OutlineKey, ReplayOutline>();
  private scale: number = 1;
  private translateX: number = 0;
  private translateY: number = 0;
  private resizeObserver: ResizeObserver | null = null;
  private skipBefore: number | null = null;

  constructor(skipBefore?: number) {
    console.log('da constructor');

    if (skipBefore) {
      this.skipBefore = skipBefore;
    }
  }

  // public async makeThumbnail(
  //   mode:
  //     | { kind: 'thumbnail'; payload: ReactScanPayload }
  //     | { kind: 'replay' } = { kind: 'replay' },
  // ) {
  //   this.mode = mode;
  //   try {
  //     console.log('calling', this.replayer, '<-');

  //     if (!this.canvas) {
  //       console.log('initing');

  //       this.initCanvas(this.replayer!.iframe);
  //     }
  //     console.log('okay...', this.mode.kind);

  //     switch (this.mode.kind) {
  //       case 'replay': {
  //         console.log('well no...');

  //         return 'fnldaskjfl;kads';
  //       }
  //       case 'thumbnail': {
  //         console.log('drawing payl');

  //         const scheduledOutlines = this.payloadToScheduledReplayableOutlines(
  //           this.mode.payload,
  //           -1
  //         );
  //         console.log('outlines', scheduledOutlines);

  //         if (!scheduledOutlines) {
  //           // invariant
  //           console.log('big el');

  //           return;
  //         }
  //         console.log('aw man');

  //         await this.activateOutlines(scheduledOutlines);
  //         // .catch(() => {
  //         //   console.log('big wooper');
  //         // });
  //         console.log('active', this, this.activeOutlines);
  //         drawThumbnailOutlines(
  //           this.ctx!,
  //           this.activeOutlines,
  //           this.translateX,
  //           this.translateY,
  //         );
  //         return 'donso!';
  //       }
  //     }
  //   } catch (e) {
  //     console.log('e', e);
  //   }
  // }

  async handler(
    event: eventWithTime,
    isSync: boolean,
    context: { replayer: any },
  ) {
    if (!this.replayer) {
      this.replayer = context.replayer;
    }

    if (
      event.type === EventType.Plugin &&
      event.data.plugin === 'react-scan-plugin'
    ) {
      // console.log('running yipee');

      const payload = event.data.payload as ReactScanPayload;
      // const nodeId = data.payload.nodeId;
      // const mirror = this.replayer!.getMirror();
      // const node = mirror.getNode(nodeId) as HTMLElement | null;

      // if (!node) {
      //   return;
      // }

      if (!this.canvas) {
        this.initCanvas(this.replayer!.iframe);
      }

      // console.log(
      //   'activated',
      //   safeDeepClone(Array.from(this.activeOutlines.values())),
      // );

      // flushOutlines();
      // this is really stupid but its fine
      const scheduledOutlines = this.payloadToScheduledReplayableOutlines(
        payload,
        event.timestamp,
      );

      if (!scheduledOutlines) {
        // invariant
        // console.log('big el');

        return;
      }
      await this.activateOutlines(scheduledOutlines);
      if (!animationFrameId) {
        // console.log('fading out');

        animationFrameId = requestAnimationFrame(() =>
          fadeOutOutlineReplay(
            this.ctx!,
            this.activeOutlines,
            this.translateX,
            this.translateY,
            this.skipBefore,
          ),
        );
      }
      // switch (this.mode.kind) {
      //   case 'replay': {

      //     return;
      //   }
      //   case 'thumbnail': {
      //     console.log('drawing payl');

      //     const scheduledOutlines = this.payloadToScheduledReplayableOutlines(
      //       this.mode.payload,
      //     );
      //     console.log('outlines', scheduledOutlines);

      //     if (!scheduledOutlines) {
      //       // invariant
      //       // console.log('big el');

      //       return;
      //     }

      //     await this.activateOutlines(scheduledOutlines);
      //     console.log('active', this, this.activateOutlines);

      //     drawThumbnailOutlines(
      //       this.ctx!,
      //       this.activeOutlines,
      //       this.translateX,
      //       this.translateY,
      //     );
      //   }
      // }
      // if (this.mode === '')

      // here we recieve the replayer

      // ReactScanInternals.scheduledOutlines.push({
      //   domNode: node,
      //   rect: node.getBoundingClientRect(),
      //   renders: data.payload.outline.renders,
      // });

      // flushOutlines(this.ctx!, previousOutlines);
    }
  }

  // this probably can be simplified? maybe?
  private initCanvas(iframe: HTMLIFrameElement) {
    this.canvas = document.createElement('canvas');
    const iframeRect = iframe.getBoundingClientRect();
    const dpi = window.devicePixelRatio || 1;
    let wrapper = iframe.parentElement;
    if (wrapper) {
      wrapper.style.position = 'relative';
    }

    const updateCanvasSize = () => {
      const newRect = iframe.getBoundingClientRect();
      const parentRect = wrapper?.getBoundingClientRect() || newRect;

      // Position relative to parent
      this.canvas!.style.cssText = `
        position: absolute;
        top: ${newRect.top - parentRect.top}px;
        left: ${newRect.left - parentRect.left}px;
        width: ${newRect.width}px;
        height: ${newRect.height}px;
        pointer-events: none;
        z-index: 2147483647;
        background: transparent;
        opacity: 1 !important;
        visibility: visible !important;
        display: block !important;
      `;

      // Update canvas dimensions
      this.canvas!.width = newRect.width * dpi;
      this.canvas!.height = newRect.height * dpi;

      if (this.ctx) {
        this.ctx.scale(dpi, dpi);
      }

      // Get both scale and translation from the transform matrix
      const transform = iframe.style.transform;
      const matrix = new DOMMatrix(transform);
      this.scale = matrix.a;
      this.translateX = matrix.e;
      this.translateY = matrix.f;
    };

    // Initial setup
    updateCanvasSize();
    iframe.parentElement?.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', {
      willReadFrequently: true,
    });

    if (this.ctx) {
      this.ctx.imageSmoothingEnabled = false; // Disable antialiasing
    }

    // Setup resize observer
    this.resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });
    this.resizeObserver.observe(iframe);
  }

  // Add cleanup method
  public destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.ctx = null;
  }

  private payloadToScheduledReplayableOutlines(
    payload: ReactScanPayload,
    timestamp: number,
  ) {
    const scheduledReplayOutlines = new Map<FiberId, ReplayOutline>();
    if (!this.replayer) {
      // invariant
      // console.log('NOPEE');

      return;
    }
    for (const event of payload) {
      // const domNode = this.replayer.getMirror().getNode(event.rrwebDomId);
      // if (!domNode) {
      //   continue;
      // }
      scheduledReplayOutlines.set(event.fiberId, {
        aggregatedRender: {
          aggregatedCount: event.renderCount,
          computedCurrent: null,
          computedKey: null,
          frame: 0,
          name: event.componentName,
          time: null,
        },
        alpha: null,
        groupedAggregatedRender: null,
        target: null,
        current: null,
        totalFrames: null,
        estimatedTextWidth: null,
        domNodeId: event.rrwebDomId,
        timestamp,
      });
    }
    // console.log('scheduled', scheduledReplayOutlines, payload.length);

    return scheduledReplayOutlines;
  }
  private async activateOutlines(scheduledOutlines: ScheduledReplayOutlines) {
    const domNodes: Array<Element> = [];
    // const scheduledOutlines = ReactScanInternals.scheduledOutlines;
    // const activeOutlines = ReactScanInternals.activeOutlines;
    const activeFibers = new Map<FiberId, ReplayAggregatedRender>();

    // fiber alternate merging and activeFiber tracking
    // shouldn't need this anymore since alternate logic is handled
    for (const activeOutline of this.activeOutlines.values()) {
      if (!activeOutline.groupedAggregatedRender) {
        continue;
      }
      for (const [
        fiber,
        aggregatedRender,
      ] of activeOutline.groupedAggregatedRender) {
        // if (fiber.alternate && activeFibers.has(fiber.alternate)) {
        //   // if it already exists, copy it over
        //   const alternateAggregatedRender = activeFibers.get(fiber.alternate);

        //   if (alternateAggregatedRender) {
        //     joinAggregations({
        //       from: alternateAggregatedRender,
        //       to: aggregatedRender,
        //     });
        //   }
        //   // fixme: this seems to leave a label/outline alive for an extra frame in some cases
        //   activeOutline.groupedAggregatedRender?.delete(fiber);
        //   activeFibers.delete(fiber.alternate);
        // }
        // match the current render to its fiber
        activeFibers.set(fiber, aggregatedRender);
      }
    }
    // handles the case where the fiber already is in a position group, and the data
    // simply needs to be merged in the existing entry
    for (const [fiberId, outline] of scheduledOutlines) {
      const existingAggregatedRender = activeFibers.get(fiberId);
      if (existingAggregatedRender) {
        // joinAggregations({
        //   to: existingAggregatedRender,
        //   from: outline.aggregatedRender,
        // });
        // existing (10count) -> incoming (100count) -> should be (110count)
        existingAggregatedRender.aggregatedCount +=
          outline.aggregatedRender.aggregatedCount;
        existingAggregatedRender.frame = 0;
      }
      // else, the later logic will handle adding the entry
      const domNode = this.replayer!.getMirror().getNode(outline.domNodeId);
      if (!domNode) {
        console.log('get fucked 2', outline.domNodeId);

        continue;
      }
      domNodes.push(domNode);
    }

    const rects = await batchGetBoundingRects(domNodes); // todo
    const totalFrames = 45;
    const alpha = 0.8;

    /**
     *  - handles calculating + updating rects, adding new outlines to a groupedAggregatedRender, and moving fibers to new position groups if their rect moved
     *
     *  - this logic makes sense together since we can only determine if an outline should be created OR moved after we calculate the latest
     *    rect for the scheduled outline since that allows us to compute the position key- first level of aggregation we do on aggregations
     *    (note: we aggregate on position because we will always merge outlines with the same rect. Within the position based aggregation we
     *     aggregate based on fiber because we want re-renders for a fibers outline to stay consistent between frames, and gives us tight
     *     control over animation restart/cancel + interpolation)
     */
    for (const [fiberId, outline] of scheduledOutlines) {
      // todo: put this behind config to use intersection observer or update speed
      // outlineUpdateSpeed: throttled | synchronous // "using synchronous updates will result in smoother animations, but add more overhead to react-scan"
      const domNode = this.replayer!.getMirror().getNode(outline.domNodeId);
      if (!domNode) {
        console.log('get fucked1 ', outline.domNodeId);

        continue;
      }
      const rect = rects.get(domNode);
      // const rect = domNode.getBoundingClientRect();
      if (!rect) {
        console.log('no rect lol');

        // intersection observer could not get a rect, so we have nothing to paint/activate
        continue;
      }

      if (rect.top === rect.bottom || rect.left === rect.right) {
        console.log('poopeoo');

        continue;
      }

      const prevAggregatedRender = activeFibers.get(fiberId);

      const isOffScreen = getIsOffscreen(rect);
      if (isOffScreen) {
        // console.log('off screen see yeah');

        continue;
      }

      const key = `${rect.x}-${rect.y}` as const;
      let existingOutline = this.activeOutlines.get(key);

      if (!existingOutline) {
        existingOutline = outline; // re-use the existing object to avoid GC time

        existingOutline.target = rect;
        existingOutline.totalFrames = totalFrames;

        existingOutline.groupedAggregatedRender = new Map([
          [fiberId, outline.aggregatedRender],
        ]);
        existingOutline.aggregatedRender.aggregatedCount =
          prevAggregatedRender?.aggregatedCount ?? 1;

        existingOutline.alpha = alpha;

        existingOutline.aggregatedRender.computedKey = key;

        // handles canceling the animation of the associated render that was painted at a different location
        if (prevAggregatedRender?.computedKey) {
          const groupOnKey = this.activeOutlines.get(
            prevAggregatedRender.computedKey,
          );
          groupOnKey?.groupedAggregatedRender?.forEach(
            (value, prevStoredFiberId) => {
              if (prevStoredFiberId === fiberId) {
                value.frame = 45; // todo: make this max frame, not hardcoded

                // for interpolation reference equality
                if (existingOutline) {
                  existingOutline.current = value.computedCurrent!;
                }
              }
            },
          );
        }
        // console.log('setting here tho');

        this.activeOutlines.set(key, existingOutline);
      } else if (!prevAggregatedRender) {
        // console.log('setting', outline.aggregatedRender);

        existingOutline.alpha = outline.alpha;
        existingOutline.groupedAggregatedRender?.set(
          fiberId,
          outline.aggregatedRender,
        );
      }
      // if there's an aggregation at the rect position AND a previously computed render
      // the previous fiber joining logic handles merging render aggregations with updated data

      // FIXME(Alexis): `|| 0` just for tseslint to shutup
      // existingOutline.alpha = Math.max(
      //   existingOutline.alpha || 0,
      //   outline.alpha || 0,
      // );

      existingOutline.totalFrames = Math.max(
        existingOutline.totalFrames || 0,
        outline.totalFrames || 0,
      );
    }
  }
}

// let animationFrameId: ReturnType<typeof requestAnimationFrame>

// export const flushOutlines = async (
//   ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
// ) => {
//   if (
//     !ReactScanInternals.scheduledOutlines.size &&
//     !ReactScanInternals.activeOutlines.size
//   ) {
//     return;
//   }

//   const flattenedScheduledOutlines = Array.from(
//     ReactScanInternals.scheduledOutlines.values(),
//   );

//   await activateOutlines();

//   recalcOutlines();

//   ReactScanInternals.scheduledOutlines = new Map();

//   const { options } = ReactScanInternals;

//   options.value.onPaintStart?.(flattenedScheduledOutlines);

//   if (!animationFrameId) {
//     animationFrameId = requestAnimationFrame(() => fadeOutOutline(ctx));
//   }
// };

let animationFrameId: number | null = null;

const shouldSkipInterpolation = (rect: DOMRect) => {
  // animations tend to transform out of screen/ to a very tiny size, those are noisy so we don't lerp them
  if (
    rect.top >= window.innerHeight || // completely below viewport
    rect.bottom <= 0 || // completely above viewport
    rect.left >= window.innerWidth || // completely right of viewport
    rect.right <= 0 // completely left of viewport
  ) {
    return true;
  }

  return !ReactScanInternals.options.value.smoothlyAnimateOutlines;
};

const DEFAULT_THROTTLE_TIME = 32; // 2 frames

const START_COLOR = { r: 115, g: 97, b: 230 };
const END_COLOR = { r: 185, g: 49, b: 115 };
const MONO_FONT =
  'Menlo,Consolas,Monaco,Liberation Mono,Lucida Console,monospace';

export const getOutlineKey = (rect: DOMRect): string => {
  return `${rect.top}-${rect.left}-${rect.width}-${rect.height}`;
};
const enum Reason {
  Commit = 0b001,
  Unstable = 0b010,
  Unnecessary = 0b100,
}
export interface ReplayOutlineLabel {
  alpha: number;
  color: { r: number; g: number; b: number };
  // reasons: number; // based on Reason enum
  labelText: string;
  textWidth: number;
  activeOutline: ReplayOutline;
}

export const drawThumbnailOutlines = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  activeOutlines: Map<OutlineKey, ReplayOutline>,
  translateX: number = 0,
  translateY: number = 0,
) => {
  const dpi = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, ctx.canvas.width / dpi, ctx.canvas.height / dpi);
  ctx.save();

  // Draw black rectangle over entire canvas
  // const dpi = window.devicePixelRatio || 1;
  const width = ctx.canvas.width / dpi;
  const height = ctx.canvas.height / dpi;

  // console.log('Drawing black rectangle:', {
  //   x: 0,
  //   y: 0,
  //   width,
  //   height,
  // });

  // ctx.fillStyle = 'black';
  // ctx.fillRect(0, 0, width, height);

  // // Test if canvas context is working
  // ctx.fillStyle = 'red';
  // ctx.fillRect(100, 100, 200, 200);
  // console.log('Drew test rectangle');

  // Track positions for label merging
  const labelPositions: Array<{
    x: number;
    y: number;
    text: string;
    alpha: number;
    color: { r: number; g: number; b: number };
  }> = [];
  console.log('about to draw demon mode', ctx);

  for (const [key, activeOutline] of activeOutlines) {
    // console.log('active outline', activeOutline);

    // invariant: active outline has "active" info non nullable at this point of the program b/c they must be activated
    const invariantActiveOutline = activeOutline as {
      [K in keyof ReplayOutline]: NonNullable<ReplayOutline[K]>;
    };

    const color = START_COLOR;
    const alpha = 0.8;
    const fillAlpha = alpha * 0.1;
    const target = invariantActiveOutline.target;

    // For screenshot, we always use target rect directly
    invariantActiveOutline.current = target;
    invariantActiveOutline.groupedAggregatedRender.forEach((v) => {
      v.computedCurrent = target;
    });

    // Draw rectangle
    const rect = invariantActiveOutline.current;
    const rgb = `${color.r},${color.g},${color.b}`;
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth = 1;
    ctx.fillStyle = `rgba(${rgb},${fillAlpha})`;

    ctx.beginPath();
    // console.log('drawing at', rect);

    ctx.rect(rect.x + translateX, rect.y + translateY, rect.width, rect.height);
    ctx.stroke();
    ctx.fill();

    // Get label text
    const labelText = getReplayLabelText(
      Array.from(invariantActiveOutline.groupedAggregatedRender.values()),
    );

    if (labelText) {
      labelPositions.push({
        x: rect.x + translateX,
        y: rect.y + translateY,
        text: labelText,
        alpha,
        color,
      });
    }
  }

  // Draw labels
  ctx.font = `11px ${MONO_FONT}`;
  const textHeight = 11;
  const padding = 4;

  // Sort labels by position for merging
  labelPositions.sort((a, b) => {
    if (Math.abs(a.y - b.y) < textHeight * 2) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  // Merge and draw labels
  let currentGroup: typeof labelPositions = [];
  let lastY = -Infinity;

  for (const label of labelPositions) {
    if (Math.abs(label.y - lastY) > textHeight * 2) {
      // Draw current group
      if (currentGroup.length > 0) {
        const mergedText = currentGroup.map((l) => l.text).join(', ');
        const { x, y, alpha, color } = currentGroup[0];
        const textMetrics = ctx.measureText(mergedText);

        // Background
        ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
        ctx.fillRect(
          x,
          y - textHeight - padding,
          textMetrics.width + padding * 2,
          textHeight + padding * 2,
        );

        // Text
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillText(mergedText, x + padding, y - padding);
      }

      // Start new group
      currentGroup = [label];
      lastY = label.y;
    } else {
      currentGroup.push(label);
    }
  }

  // Draw final group
  if (currentGroup.length > 0) {
    const mergedText = currentGroup.map((l) => l.text).join(', ');
    const { x, y, alpha, color } = currentGroup[0];
    const textMetrics = ctx.measureText(mergedText);

    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${1})`;
    ctx.fillRect(
      x,
      y - textHeight - padding,
      textMetrics.width + padding * 2,
      textHeight + padding * 2,
    );

    ctx.fillStyle = `rgba(255,255,255,${1})`;
    ctx.fillText(mergedText, x + padding, y - padding);
  }

  ctx.restore();
};

export const fadeOutOutlineReplay = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  activeOutlines: Map<OutlineKey, ReplayOutline>,
  translateX: number = 0,
  translateY: number = 0,
  skipBefore: number | null,
) => {
  const dpi = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, ctx.canvas.width / dpi, ctx.canvas.height / dpi);
  ctx.save();

  // Track positions for label merging
  const labelPositions: Array<{
    x: number;
    y: number;
    text: string;
    alpha: number;
    color: { r: number; g: number; b: number };
  }> = [];

  console.log('active', activeOutlines);

  for (const [key, activeOutline] of activeOutlines) {
    // invariant: active outline has "active" info non nullable at this point of the program b/c they must be activated
    const invariantActiveOutline = activeOutline as {
      [K in keyof ReplayOutline]: NonNullable<ReplayOutline[K]>;
    };
    let frame;

    for (const aggregatedRender of invariantActiveOutline.groupedAggregatedRender.values()) {
      aggregatedRender.frame! += 1;
      frame = frame
        ? Math.max(aggregatedRender.frame!, frame)
        : aggregatedRender.frame!;
    }

    if (!frame) {
      activeOutlines.delete(key);
      continue;
    }

    const t = 0;
    const r = Math.round(START_COLOR.r + t * (END_COLOR.r - START_COLOR.r));
    const g = Math.round(START_COLOR.g + t * (END_COLOR.g - START_COLOR.g));
    const b = Math.round(START_COLOR.b + t * (END_COLOR.b - START_COLOR.b));
    const color = { r, g, b };

    const alphaScalar = 0.8;
    invariantActiveOutline.alpha =
      alphaScalar * Math.max(0, 1 - frame / invariantActiveOutline.totalFrames);

    const alpha = invariantActiveOutline.alpha;
    const fillAlpha = alpha * 0.1;
    const target = invariantActiveOutline.target;

    const shouldSkip = shouldSkipInterpolation(target);
    if (shouldSkip) {
      invariantActiveOutline.current = target;
      invariantActiveOutline.groupedAggregatedRender.forEach((v) => {
        v.computedCurrent = target;
      });
    } else {
      if (!invariantActiveOutline.current) {
        invariantActiveOutline.current = new DOMRect(
          target.x,
          target.y,
          target.width,
          target.height,
        );
      }

      const INTERPOLATION_SPEED = 0.2;
      const current = invariantActiveOutline.current;

      const lerp = (start: number, end: number) => {
        return start + (end - start) * INTERPOLATION_SPEED;
      };

      const computedCurrent = new DOMRect(
        lerp(current.x, target.x),
        lerp(current.y, target.y),
        lerp(current.width, target.width),
        lerp(current.height, target.height),
      );

      invariantActiveOutline.current = computedCurrent;

      invariantActiveOutline.groupedAggregatedRender.forEach((v) => {
        v.computedCurrent = computedCurrent;
      });
    }

    // Draw rectangle
    const rect = invariantActiveOutline.current;
    const rgb = `${color.r},${color.g},${color.b}`;
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth = 1;
    ctx.fillStyle = `rgba(${rgb},${fillAlpha})`;

    ctx.beginPath();
    ctx.rect(rect.x + translateX, rect.y + translateY, rect.width, rect.height);
    ctx.stroke();
    ctx.fill();

    // Get label text
    const labelText = getReplayLabelText(
      Array.from(invariantActiveOutline.groupedAggregatedRender.values()),
    );

    if (labelText) {
      labelPositions.push({
        x: rect.x + translateX,
        y: rect.y + translateY,
        text: labelText,
        alpha,
        color,
      });
    }

    const totalFrames = invariantActiveOutline.totalFrames;
    for (const [
      fiber,
      aggregatedRender,
    ] of invariantActiveOutline.groupedAggregatedRender) {
      if (aggregatedRender.frame! >= totalFrames) {
        invariantActiveOutline.groupedAggregatedRender.delete(fiber);
      }
    }

    if (invariantActiveOutline.groupedAggregatedRender.size === 0) {
      activeOutlines.delete(key);
    }
  }

  // Draw labels
  ctx.font = `11px ${MONO_FONT}`;
  const textHeight = 11;
  const padding = 4;

  // Sort labels by position for merging
  labelPositions.sort((a, b) => {
    if (Math.abs(a.y - b.y) < textHeight * 2) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  let currentGroup: typeof labelPositions = [];
  let lastY = -Infinity;

  for (const label of labelPositions) {
    if (Math.abs(label.y - lastY) > textHeight * 2) {
      // Draw current group
      if (currentGroup.length > 0) {
        const mergedText = currentGroup.map((l) => l.text).join(', ');
        const { x, y, alpha, color } = currentGroup[0];
        const textMetrics = ctx.measureText(mergedText);

        // Background
        ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
        ctx.fillRect(
          x,
          y - textHeight - padding,
          textMetrics.width + padding * 2,
          textHeight + padding * 2,
        );

        // Text
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillText(mergedText, x + padding, y - padding);
      }

      // Start new group
      currentGroup = [label];
      lastY = label.y;
    } else {
      currentGroup.push(label);
    }
  }

  if (currentGroup.length > 0) {
    const mergedText = currentGroup.map((l) => l.text).join(', ');
    const { x, y, alpha, color } = currentGroup[0];
    const textMetrics = ctx.measureText(mergedText);

    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
    ctx.fillRect(
      x,
      y - textHeight - padding,
      textMetrics.width + padding * 2,
      textHeight + padding * 2,
    );

    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillText(mergedText, x + padding, y - padding);
  }

  ctx.restore();

  if (activeOutlines.size) {
    animationFrameId = requestAnimationFrame(() =>
      fadeOutOutlineReplay(
        ctx,
        activeOutlines,
        translateX,
        translateY,
        skipBefore,
      ),
    );
  } else {
    animationFrameId = null;
  }
};
const textMeasurementCache = new LRUMap<string, TextMetrics>(100);

export const measureTextCachedReplay = (
  text: string,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): TextMetrics => {
  if (textMeasurementCache.has(text)) {
    return textMeasurementCache.get(text)!;
  }
  ctx.font = `11px ${MONO_FONT}`;
  const metrics = ctx.measureText(text);
  textMeasurementCache.set(text, metrics);
  return metrics;
};

export const getReplayLabelText = (
  groupedAggregatedRenders: Array<ReplayAggregatedRender>,
) => {
  let labelText = '';

  const componentsByCount = new Map<
    number,
    Array<{ name: string; time: number }>
  >();

  for (const aggregatedRender of groupedAggregatedRenders) {
    const { time, aggregatedCount, name } = aggregatedRender;
    if (!componentsByCount.has(aggregatedCount)) {
      componentsByCount.set(aggregatedCount, []);
    }
    componentsByCount.get(aggregatedCount)!.push({ name, time: time ?? 0 });
  }

  const sortedCounts = Array.from(componentsByCount.keys()).sort(
    (a, b) => b - a,
  );

  const parts: Array<string> = [];
  let cumulativeTime = 0;
  for (const count of sortedCounts) {
    const componentGroup = componentsByCount.get(count)!;
    const names = componentGroup
      .slice(0, 4)
      .map(({ name }) => name)
      .join(', ');
    let text = names;

    const totalTime = componentGroup.reduce((sum, { time }) => sum + time, 0);

    cumulativeTime += totalTime;

    if (componentGroup.length > 4) {
      text += '…';
    }

    if (count > 1) {
      text += ` ×${count}`;
    }

    parts.push(text);
  }

  labelText = parts.join(', ');

  if (!labelText.length) return null;

  if (labelText.length > 40) {
    labelText = `${labelText.slice(0, 40)}…`;
  }

  if (cumulativeTime >= 0.01) {
    labelText += ` (${Number(cumulativeTime.toFixed(2))}ms)`;
  }

  return labelText;
};

export interface MergedReplayOutlineLabel {
  alpha: number;
  color: { r: number; g: number; b: number };
  // reasons: number;
  groupedAggregatedRender: Array<ReplayAggregatedRender>;
  rect: DOMRect;
}

function toMergedReplayLabel(
  label: ReplayOutlineLabel,
  rectOverride?: DOMRect,
): MergedReplayOutlineLabel {
  const baseRect = rectOverride ?? label.activeOutline.current!;
  const rect = applyLabelTransform(baseRect, label.textWidth);
  const groupedArray = Array.from(
    label.activeOutline.groupedAggregatedRender!.values(),
  );
  return {
    alpha: label.alpha,
    color: label.color,
    groupedAggregatedRender: groupedArray,
    rect,
  };
}
// todo: optimize me so this can run always
// note: this can be implemented in nlogn using https://en.wikipedia.org/wiki/Sweep_line_algorithm
export const replayMergeOverlappingLabels = (
  labels: Array<ReplayOutlineLabel>,
): Array<MergedReplayOutlineLabel> => {
  if (labels.length > 1500) {
    return labels.map((label) => toMergedReplayLabel(label));
  }

  const transformed = labels.map((label) => ({
    original: label,
    rect: applyLabelTransform(
      new DOMRect(
        label.activeOutline.current!.x, // Don't scale here
        label.activeOutline.current!.y,
        label.activeOutline.current!.width,
        label.activeOutline.current!.height,
      ),
      label.textWidth,
    ),
  }));

  // Sort by y position first, then x
  transformed.sort((a, b) => {
    if (Math.abs(a.rect.y - b.rect.y) < 20) {
      // Group labels within 20px vertical distance
      return a.rect.x - b.rect.x;
    }
    return a.rect.y - b.rect.y;
  });

  const mergedLabels: Array<MergedReplayOutlineLabel> = [];
  const mergedSet = new Set<number>();

  for (let i = 0; i < transformed.length; i++) {
    if (mergedSet.has(i)) continue;

    let currentMerged = toMergedReplayLabel(
      transformed[i].original,
      transformed[i].rect,
    );
    let currentRight = currentMerged.rect.x + currentMerged.rect.width;
    let currentBottom = currentMerged.rect.y + currentMerged.rect.height;

    for (let j = i + 1; j < transformed.length; j++) {
      if (mergedSet.has(j)) continue;

      const nextRect = transformed[j].rect;

      // Check if labels are close enough vertically and overlapping horizontally
      if (
        Math.abs(nextRect.y - transformed[i].rect.y) < 20 &&
        nextRect.x <= currentRight + 10
      ) {
        // Allow small gap between labels
        const nextLabel = toMergedReplayLabel(
          transformed[j].original,
          nextRect,
        );
        currentMerged = mergeTwoReplayLabels(currentMerged, nextLabel);
        mergedSet.add(j);

        currentRight = Math.max(
          currentRight,
          currentMerged.rect.x + currentMerged.rect.width,
        );
        currentBottom = Math.max(
          currentBottom,
          currentMerged.rect.y + currentMerged.rect.height,
        );
      }
    }

    mergedLabels.push(currentMerged);
  }

  return mergedLabels;
};

function mergeTwoReplayLabels(
  a: MergedReplayOutlineLabel,
  b: MergedReplayOutlineLabel,
): MergedReplayOutlineLabel {
  const mergedRect = getBoundingRect(a.rect, b.rect);

  const mergedGrouped = a.groupedAggregatedRender.concat(
    b.groupedAggregatedRender,
  );

  // const mergedReasons = a.reasons | b.reasons;

  return {
    alpha: Math.max(a.alpha, b.alpha),

    ...pickColorClosestToStartStage(a, b), // kinda wrong, should pick color in earliest stage
    // reasons: mergedReasons,
    groupedAggregatedRender: mergedGrouped,
    rect: mergedRect,
  };
}
