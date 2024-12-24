import type { Fiber } from 'react-reconciler';
import type * as React from 'react';
import { type Signal, signal } from '@preact/signals';
import {
  getDisplayName,
  getRDTHook,
  getNearestHostFiber,
  getTimings,
  getType,
  isCompositeFiber,
  isInstrumentationActive,
  traverseFiber,
  detectReactBuildType,
} from 'bippy';
import {
  batchGetBoundingRects,
  flushOutlines,
  type Outline,
} from '@web-utils/outline';
import { log, logIntro } from '@web-utils/log';
import {
  createInspectElementStateMachine,
  type States,
} from '@web-inspect-element/inspect-state-machine';
import { playGeigerClickSound } from '@web-utils/geiger';
import { ICONS } from '@web-assets/svgs/svgs';
import {
  aggregateChanges,
  aggregateRender,
  updateFiberRenderData,
  type RenderData,
} from 'src/core/utils';
import { readLocalStorage, saveLocalStorage } from '@web-utils/helpers';
import { initReactScanOverlay } from './web/overlay';
import { createInstrumentation, type Render } from './instrumentation';
import { createToolbar } from './web/toolbar';
import type {
  InternalInteraction,
  PerformanceInteraction,
} from './monitor/types';
import { type getSession } from './monitor/utils';
import styles from './web/assets/css/styles.css';
import {
  getElementFromPerformanceEntry,
  setupPerformanceListener,
} from 'src/core/monitor/performance';
import { getNearestFiberFromElement } from '@web-inspect-element/utils';

let toolbarContainer: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;

export interface Options {
  /**
   * Enable/disable scanning
   *
   * Please use the recommended way:
   * enabled: process.env.NODE_ENV === 'development',
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Include children of a component applied with withScan
   *
   * @default true
   */
  includeChildren?: boolean;

  /**
   * Force React Scan to run in production (not recommended)
   *
   * @default false
   */
  dangerouslyForceRunInProduction?: boolean;

  /**
   * Enable/disable geiger sound
   *
   * @default true
   */
  playSound?: boolean;

  /**
   * Log renders to the console
   *
   * WARNING: This can add significant overhead when the app re-renders frequently
   *
   * @default false
   */
  log?: boolean;

  /**
   * Show toolbar bar
   *
   * If you set this to true, and set {@link enabled} to false, the toolbar will still show, but scanning will be disabled.
   *
   * @default true
   */
  showToolbar?: boolean;

  /**
   * Render count threshold, only show
   * when a component renders more than this
   *
   * @default 0
   */
  renderCountThreshold?: number;

  /**
   * Clear aggregated fibers after this time in milliseconds
   *
   * @default 5000
   */
  resetCountTimeout?: number;

  /**
   * Maximum number of renders for red indicator
   *
   * @default 20
   * @deprecated
   */
  maxRenders?: number;

  /**
   * Report data to getReport()
   *
   * @default false
   */
  report?: boolean;

  /**
   * Always show labels
   *
   * @default false
   */
  alwaysShowLabels?: boolean;

  /**
   * Animation speed
   *
   * @default "fast"
   */
  animationSpeed?: 'slow' | 'fast' | 'off';

  /**
   * Smoothly animate the re-render outline when the element moves
   *
   * @default true
   */
  smoothlyAnimateOutlines?: boolean;

  /**
   * Track unnecessary renders, and mark their outlines gray when detected
   *
   * An unnecessary render is defined as the component re-rendering with no change to the component's
   * corresponding dom subtree
   *
   *  @default false
   *  @warning tracking unnecessary renders can add meaningful overhead to react-scan
   */
  trackUnnecessaryRenders?: boolean;

  onCommitStart?: () => void;
  onRender?: (fiber: Fiber, renders: Array<Render>) => void;
  onCommitFinish?: () => void;
  onPaintStart?: (outlines: Array<Outline>) => void;
  onPaintFinish?: (outlines: Array<Outline>) => void;
}

export type MonitoringOptions = Pick<
  Options,
  | 'includeChildren'
  | 'enabled'
  | 'renderCountThreshold'
  | 'resetCountTimeout'
  | 'onCommitStart'
  | 'onCommitFinish'
  | 'onPaintStart'
  | 'onPaintFinish'
  | 'onRender'
>;

interface Monitor {
  pendingRequests: number;
  interactions: Array<InternalInteraction>;
  session: ReturnType<typeof getSession>;
  url: string | null;
  route: string | null;
  apiKey: string | null;
  commit: string | null;
  branch: string | null;
}

interface StoreType {
  wasDetailsOpen: Signal<boolean>;
  isInIframe: Signal<boolean>;
  inspectState: Signal<States>;
  monitor: Signal<Monitor | null>;
  fiberRoots: WeakSet<Fiber>;
  reportData: WeakMap<Fiber, RenderData>;
  legacyReportData: Map<string, RenderData>;
  lastReportTime: Signal<number>;
}

export type OutlineKey = `${string}-${string}`;

interface Particle {
  x: number;
  y: number;
  alpha: number;
  velocity: { x: number; y: number };
  size?: number;
  life?: number;
}

interface FireParticle extends Particle {
  hue: number;
  life: number;
  maxLife: number;
}

interface InteractionOutline {
  rect: DOMRect;
  frame: number;
  alpha: number;
  color: { r: number; g: number; b: number };
  particles?: Particle[];
  fireParticles?: FireParticle[];
}

interface DOMInteraction {
  kind: 'pointer' | 'keyboard';
  time: number;
  outline: InteractionOutline;
  element: Element;
}

export interface Internals {
  instrumentation: ReturnType<typeof createInstrumentation> | null;
  componentAllowList: WeakMap<React.ComponentType<any>, Options> | null;
  options: Signal<Options>;
  scheduledOutlines: Map<Fiber, Outline>; // we clear t,his nearly immediately, so no concern of mem leak on the fiber
  // outlines at the same coordinates always get merged together, so we pre-compute the merge ahead of time when aggregating in activeOutlines
  activeOutlines: Map<OutlineKey, Outline>; // we re-use the outline object on the scheduled outline
  // active interaction outlines should work with or without react on the site, and should only be progressively enhanced
  activeInteractionOutlines: Map<Element, DOMInteraction>;
  onRender: ((fiber: Fiber, renders: Array<Render>) => void) | null;
  Store: StoreType;
}

export const Store: StoreType = {
  wasDetailsOpen: signal(true),
  isInIframe: signal(
    typeof window !== 'undefined' && window.self !== window.top,
  ),
  inspectState: signal<States>({
    kind: 'uninitialized',
  }),
  monitor: signal<Monitor | null>(null),
  fiberRoots: new WeakSet<Fiber>(),
  reportData: new WeakMap<Fiber, RenderData>(),
  legacyReportData: new Map<string, RenderData>(),
  lastReportTime: signal(0),
};

export const ReactScanInternals: Internals = {
  instrumentation: null,
  componentAllowList: null,
  options: signal({
    enabled: true,
    includeChildren: true,
    playSound: false,
    log: false,
    showToolbar: true,
    renderCountThreshold: 0,
    report: undefined,
    alwaysShowLabels: false,
    animationSpeed: 'fast',
    dangerouslyForceRunInProduction: false,
    smoothlyAnimateOutlines: true,
    trackUnnecessaryRenders: false,
  }),
  onRender: null,
  scheduledOutlines: new Map(),
  activeOutlines: new Map(),
  activeInteractionOutlines: new Map(),
  Store,
};

type LocalStorageOptions = Omit<
  Options,
  | 'onCommitStart'
  | 'onRender'
  | 'onCommitFinish'
  | 'onPaintStart'
  | 'onPaintFinish'
>;

const validateOptions = (options: Partial<Options>): Partial<Options> => {
  const errors: Array<string> = [];
  const validOptions: Partial<Options> = {};

  for (const key in options) {
    const value = options[key as keyof Options];
    switch (key) {
      case 'enabled':
      case 'includeChildren':
      case 'playSound':
      case 'log':
      case 'showToolbar':
      case 'report':
      case 'alwaysShowLabels':
      case 'dangerouslyForceRunInProduction':
        if (typeof value !== 'boolean') {
          errors.push(`- ${key} must be a boolean. Got "${value}"`);
        } else {
          (validOptions as any)[key] = value;
        }
        break;
      case 'renderCountThreshold':
      case 'resetCountTimeout':
        if (typeof value !== 'number' || value < 0) {
          errors.push(`- ${key} must be a non-negative number. Got "${value}"`);
        } else {
          (validOptions as any)[key] = value;
        }
        break;
      case 'animationSpeed':
        if (!['slow', 'fast', 'off'].includes(value as string)) {
          errors.push(
            `- Invalid animation speed "${value}". Using default "fast"`,
          );
        } else {
          (validOptions as any)[key] = value;
        }
        break;
      case 'onCommitStart':
      case 'onCommitFinish':
      case 'onRender':
      case 'onPaintStart':
      case 'onPaintFinish':
        if (typeof value !== 'function') {
          errors.push(`- ${key} must be a function. Got "${value}"`);
        } else {
          (validOptions as any)[key] = value;
        }
        break;
      case 'trackUnnecessaryRenders': {
        validOptions.trackUnnecessaryRenders =
          typeof value === 'boolean' ? value : false;
        break;
      }

      case 'smoothlyAnimateOutlines': {
        validOptions.smoothlyAnimateOutlines =
          typeof value === 'boolean' ? value : false;
        break;
      }
      default:
        errors.push(`- Unknown option "${key}"`);
    }
  }

  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[React Scan] Invalid options:\n${errors.join('\n')}`);
  }

  return validOptions;
};

export const getReport = (type?: React.ComponentType<any>) => {
  if (type) {
    for (const reportData of Array.from(Store.legacyReportData.values())) {
      if (reportData.type === type) {
        return reportData;
      }
    }
    return null;
  }
  return Store.legacyReportData;
};

export const setOptions = (userOptions: Partial<Options>) => {
  const validOptions = validateOptions(userOptions);

  if (Object.keys(validOptions).length === 0) {
    return;
  }

  if ('playSound' in validOptions && validOptions.playSound) {
    validOptions.enabled = true;
  }

  const newOptions = {
    ...ReactScanInternals.options.value,
    ...validOptions,
  };

  const { instrumentation } = ReactScanInternals;
  if (instrumentation && 'enabled' in validOptions) {
    instrumentation.isPaused.value = validOptions.enabled === false;
  }

  ReactScanInternals.options.value = newOptions;

  saveLocalStorage('react-scan-options', newOptions);

  if ('showToolbar' in validOptions) {
    if (toolbarContainer && !newOptions.showToolbar) {
      toolbarContainer.remove();
    }

    if (newOptions.showToolbar && toolbarContainer && shadowRoot) {
      toolbarContainer = createToolbar(shadowRoot);
    }
  }
};

export const getOptions = () => ReactScanInternals.options;

export const reportRender = (fiber: Fiber, renders: Array<Render>) => {
  const reportFiber = fiber;
  const { selfTime } = getTimings(fiber.type);
  const displayName = getDisplayName(fiber.type);

  Store.lastReportTime.value = Date.now();

  const currentFiberData = Store.reportData.get(reportFiber) ?? {
    count: 0,
    time: 0,
    renders: [],
    displayName,
    type: null,
  };

  currentFiberData.count =
    Number(currentFiberData.count || 0) + Number(renders.length);
  currentFiberData.time =
    Number(currentFiberData.time || 0) + Number(selfTime || 0);
  currentFiberData.renders = renders;

  Store.reportData.set(reportFiber, currentFiberData);

  if (displayName && ReactScanInternals.options.value.report) {
    const existingLegacyData = Store.legacyReportData.get(displayName) ?? {
      count: 0,
      time: 0,
      renders: [],
      displayName: null,
      type: getType(fiber.type) || fiber.type,
    };

    existingLegacyData.count = existingLegacyData.time =
      Number(existingLegacyData.time || 0) + Number(selfTime || 0);
    existingLegacyData.renders = renders;

    Store.legacyReportData.set(displayName, existingLegacyData);
  }
};

export const isValidFiber = (fiber: Fiber) => {
  if (ignoredProps.has(fiber.memoizedProps)) {
    return false;
  }

  const allowList = ReactScanInternals.componentAllowList;
  const shouldAllow =
    allowList?.has(fiber.type) ?? allowList?.has(fiber.elementType);

  if (shouldAllow) {
    const parent = traverseFiber(
      fiber,
      (node) => {
        const options =
          allowList?.get(node.type) ?? allowList?.get(node.elementType);
        return options?.includeChildren;
      },
      true,
    );
    if (!parent && !shouldAllow) return false;
  }
  return true;
};

let flushInterval: ReturnType<typeof setInterval>;
const startFlushOutlineInterval = (ctx: CanvasRenderingContext2D) => {
  clearInterval(flushInterval);
  setInterval(() => {
    requestAnimationFrame(() => {
      flushOutlines(ctx);
    });
  }, 30);
};

const drawInteractionOutline = (
  domInteraction: DOMInteraction,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
) => {
  fadeOutInteractionOutline(domInteraction, ctx);
};

const TOTAL_INTERACTION_OUTLINE_FRAMES = 158;

const drawFireEffect = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  frame: number,
  alpha: number,
) => {
  const flameHeight = 10;
  const segments = 12;
  const cornerOffset = 3;
  const segmentWidth = (width - cornerOffset * 2) / segments;

  ctx.globalCompositeOperation = 'screen';

  ctx.beginPath();
  ctx.moveTo(x + cornerOffset, y);

  for (let i = 0; i <= segments; i++) {
    const xPos = x + cornerOffset + i * segmentWidth;
    const time = frame * 0.15 + i * 0.8;

    const noise1 = Math.sin(time * 1.5) * 5;
    const noise2 = Math.cos(time * 0.8 + i) * 4;
    const noise3 = Math.sin((time + i) * 0.3) * 8;

    const jitter = (Math.random() - 0.5) * 3;

    const flameY = y - Math.abs(noise1 + noise2 + noise3 + jitter);

    if (i === 0) {
      ctx.moveTo(xPos, y);
    } else {
      const cpX = xPos - segmentWidth / 2 + (Math.random() - 0.5) * 5;
      const cpY = flameY + (Math.random() - 0.5) * 8;
      ctx.quadraticCurveTo(cpX, cpY, xPos, flameY);
    }
  }

  ctx.lineTo(x + width - cornerOffset, y);

  const gradient = ctx.createLinearGradient(x, y - flameHeight, x, y);
  gradient.addColorStop(0, `hsla(15, 100%, 50%, 0)`);
  gradient.addColorStop(0.3, `hsla(20, 100%, 50%, ${alpha * 0.7})`);
  gradient.addColorStop(0.6, `hsla(35, 100%, 70%, ${alpha})`);
  gradient.addColorStop(0.8, `hsla(45, 100%, 60%, ${alpha})`);
  gradient.addColorStop(1, `hsla(15, 100%, 50%, ${alpha})`);

  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
};

const fadeOutInteractionOutline = (
  domInteraction: DOMInteraction,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
) => {
  const dpi = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, ctx.canvas.width / dpi, ctx.canvas.height / dpi);

  const labelText = `${Math.round(domInteraction.time)}ms`;
  ctx.font = 'bold 16px system-ui';
  const textMetrics = ctx.measureText(labelText);
  const textWidth = textMetrics.width;
  const textHeight = 16;
  const padding = 6;
  const labelBoxHeight = textHeight + padding * 2;

  domInteraction.outline.frame -= 1;
  domInteraction.outline.alpha =
    domInteraction.outline.frame / TOTAL_INTERACTION_OUTLINE_FRAMES;

  const { alpha, color, rect } = domInteraction.outline;
  const rgb = `${color.r},${color.g},${color.b}`;
  const isWarning = domInteraction.time >= 100;
  const isCritical = domInteraction.time >= 200;

  const labelRect = {
    x: rect.x,
    y: rect.y,
    width: textWidth + padding * 2,
    height: labelBoxHeight,
  };

  const labelTop = labelRect.y - labelBoxHeight - 4;

  if (isCritical && !domInteraction.outline.fireParticles) {
    domInteraction.outline.fireParticles = Array.from(
      { length: Math.ceil(labelRect.width / 15) },
      (_, i) => ({
        x: labelRect.x - padding + i * 15 + Math.random() * 10,
        y: labelTop,
        alpha: 1,
        velocity: {
          x: (Math.random() - 0.5) * 0.8,
          y: -Math.random() * 1.2 - 0.8,
        },
        hue: Math.random() * 30 + 15,
        life: Math.random() * 20 + 15,
        maxLife: 35,
      }),
    );
  }

  const glowStrength = isCritical ? 15 : isWarning ? 12 : 8;
  ctx.shadowColor = isCritical
    ? `rgba(255,100,0,${alpha * 0.6})`
    : `rgba(${rgb},${alpha * 0.6})`;
  ctx.shadowBlur = glowStrength;
  ctx.strokeStyle = `rgba(${rgb},${alpha})`;
  ctx.lineWidth = isCritical ? 3 : 2;
  ctx.fillStyle = `rgba(${rgb},${alpha * 0.1})`;

  const radius = 4;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  ctx.stroke();
  ctx.fill();

  if (isCritical && domInteraction.outline.fireParticles) {
    ctx.globalCompositeOperation = 'screen';

    domInteraction.outline.fireParticles.forEach((particle, i) => {
      particle.life -= 0.7;
      if (particle.life <= 0) {
        const particleIndex = i % Math.ceil(labelRect.width / 15);
        particle.x =
          labelRect.x - padding + particleIndex * 15 + Math.random() * 10;
        particle.y = labelTop;
        particle.life = particle.maxLife;
        particle.alpha = 1;
        particle.velocity.x = (Math.random() - 0.5) * 0.8;
        particle.velocity.y = -Math.random() * 1.2 - 0.8;
      }

      particle.x += particle.velocity.x;
      particle.y += particle.velocity.y;
      particle.velocity.y *= 0.97;

      const distanceFromSource = labelRect.y - particle.y;
      particle.x +=
        Math.sin(particle.y * 0.1 + domInteraction.outline.frame * 0.05) *
        (0.3 * (distanceFromSource / 50));

      const lifeRatio = particle.life / particle.maxLife;
      const particleAlpha = lifeRatio * alpha;

      const size = 1.8 * (1 + distanceFromSource / 50);
      const gradient = ctx.createRadialGradient(
        particle.x,
        particle.y,
        0,
        particle.x,
        particle.y,
        size * lifeRatio,
      );

      const baseHue = particle.hue - distanceFromSource / 4;
      gradient.addColorStop(0, `hsla(${baseHue}, 100%, 50%, ${particleAlpha})`);
      gradient.addColorStop(
        0.5,
        `hsla(${baseHue + 15}, 100%, 50%, ${particleAlpha * 0.5})`,
      );
      gradient.addColorStop(1, 'hsla(0, 0%, 0%, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, size * lifeRatio, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.shadowColor = `rgba(0,0,0,${alpha * 0.3})`;
  ctx.shadowBlur = 12;
  ctx.fillStyle = `rgba(${rgb},${alpha})`;
  ctx.beginPath();
  ctx.roundRect(
    labelRect.x - padding,
    labelTop,
    textWidth + padding * 2,
    labelBoxHeight,
    4,
  );
  ctx.fill();

  if (isCritical) {
    drawFireEffect(
      ctx,
      labelRect.x - padding,
      labelTop,
      textWidth + padding * 2,
      domInteraction.outline.frame * 1.2,
      alpha,
    );
  }

  ctx.shadowColor = `rgba(0,0,0,${alpha * 0.5})`;
  ctx.shadowBlur = 2;
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    labelText,
    labelRect.x - padding + (textWidth + padding * 2) / 2,
    labelTop + labelBoxHeight / 2,
  );

  if (isCritical && domInteraction.outline.fireParticles) {
    domInteraction.outline.fireParticles.forEach((particle, i) => {
      particle.life -= 0.7;
      if (particle.life <= 0) {
        const particleIndex = i % Math.ceil(labelRect.width / 15);
        particle.x =
          labelRect.x - padding + particleIndex * 15 + Math.random() * 10;
        particle.y = labelTop;
        particle.life = particle.maxLife;
        particle.alpha = 1;
        particle.velocity.x = (Math.random() - 0.5) * 0.8;
        particle.velocity.y = -Math.random() * 1.2 - 0.8;
      }

      particle.x += particle.velocity.x;
      particle.y += particle.velocity.y;
      particle.velocity.y *= 0.97;

      const distanceFromSource = labelRect.y - particle.y;
      particle.x +=
        Math.sin(particle.y * 0.1 + domInteraction.outline.frame * 0.05) *
        (0.3 * (distanceFromSource / 50));

      const lifeRatio = particle.life / particle.maxLife;
      const particleAlpha = lifeRatio * alpha;

      const size = 1.8 * (1 + distanceFromSource / 50);
      const gradient = ctx.createRadialGradient(
        particle.x,
        particle.y,
        0,
        particle.x,
        particle.y,
        size * lifeRatio,
      );

      const baseHue = particle.hue - distanceFromSource / 4;
      gradient.addColorStop(0, `hsla(${baseHue}, 100%, 50%, ${particleAlpha})`);
      gradient.addColorStop(
        0.5,
        `hsla(${baseHue + 15}, 100%, 50%, ${particleAlpha * 0.5})`,
      );
      gradient.addColorStop(1, 'hsla(0, 0%, 0%, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, size * lifeRatio, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // todo: flip condition to converse
  if (domInteraction.outline.frame <= 0) {
    ReactScanInternals.activeInteractionOutlines.delete(domInteraction.element);
    return;
  }

  requestAnimationFrame(() => fadeOutInteractionOutline(domInteraction, ctx));
};

const updateScheduledOutlines = (fiber: Fiber, renders: Array<Render>) => {
  for (let i = 0, len = renders.length; i < len; i++) {
    const render = renders[i];
    const domFiber = getNearestHostFiber(fiber);
    if (!domFiber || !domFiber.stateNode) continue;

    if (ReactScanInternals.scheduledOutlines.has(fiber)) {
      const existingOutline = ReactScanInternals.scheduledOutlines.get(fiber)!;
      aggregateRender(render, existingOutline.aggregatedRender);
    } else {
      ReactScanInternals.scheduledOutlines.set(fiber, {
        domNode: domFiber.stateNode,
        aggregatedRender: {
          computedCurrent: null,
          name:
            renders.find((render) => render.componentName)?.componentName ??
            'N/A',
          aggregatedCount: 1,
          changes: aggregateChanges(render.changes),
          didCommit: render.didCommit,
          forget: render.forget,
          fps: render.fps,
          phase: new Set([render.phase]),
          time: render.time,
          unnecessary: render.unnecessary,
          frame: 0,
          computedKey: null,
        },
        alpha: null,
        groupedAggregatedRender: null,
        target: null,
        current: null,
        totalFrames: null,
        estimatedTextWidth: null,
      });
    }
  }
};
// we only need to run this check once and will read the value in hot path, so best to cache indefinitely
let isProduction: boolean | null = null;
let rdtHook: ReturnType<typeof getRDTHook>;
export const getIsProduction = () => {
  if (isProduction !== null) {
    return isProduction;
  }
  rdtHook ??= getRDTHook();
  for (const renderer of rdtHook.renderers.values()) {
    const buildType = detectReactBuildType(renderer);
    if (buildType === 'production') {
      isProduction = true;
    }
  }
  return isProduction;
};

let unSubPerformanceListener: null | (() => void);

export const getColorFromPerformanceEntry = (entry: PerformanceInteraction) => {
  const duration = Math.min(entry.duration, 400);
  const ratio = (duration - 150) / 250; // Normalize between 150ms and 400ms

  // Start with orange (255, 165, 0) and transition to dark red (139, 0, 0)
  const red = Math.round(255 - ratio * (255 - 139)); // 255 -> 139
  const green = Math.round(165 * (1 - ratio)); // 165 -> 0

  return { r: red, g: green, b: 0 };
};

export const start = () => {
  if (typeof window === 'undefined') return;

  if (
    getIsProduction() &&
    !ReactScanInternals.options.value.dangerouslyForceRunInProduction
  ) {
    return;
  }

  const rdtHook = getRDTHook();
  for (const renderer of rdtHook.renderers.values()) {
    const buildType = detectReactBuildType(renderer);
    if (buildType === 'production') {
      isProduction = true;
    }
  }
  const localStorageOptions =
    readLocalStorage<LocalStorageOptions>('react-scan-options');

  if (localStorageOptions) {
    const { enabled, playSound } = localStorageOptions;
    const validLocalOptions = validateOptions({ enabled, playSound });
    if (Object.keys(validLocalOptions).length > 0) {
      ReactScanInternals.options.value = {
        ...ReactScanInternals.options.value,
        ...validLocalOptions,
      };
    }
  }

  const audioContext =
    typeof window !== 'undefined'
      ? new (
          window.AudioContext ||
          // @ts-expect-error -- This is a fallback for Safari
          window.webkitAudioContext
        )()
      : null;

  let ctx: ReturnType<typeof initReactScanOverlay> | null = null;
  const instrumentation = createInstrumentation('devtools', {
    onActive() {
      const existingRoot = document.querySelector('react-scan-root');
      if (existingRoot) {
        return;
      }

      const container = document.createElement('div');
      container.id = 'react-scan-root';

      shadowRoot = container.attachShadow({ mode: 'open' });

      const fragment = document.createDocumentFragment();

      const cssStyles = document.createElement('style');
      cssStyles.textContent = styles;

      const iconSprite = new DOMParser().parseFromString(
        ICONS,
        'image/svg+xml',
      ).documentElement;
      shadowRoot.appendChild(iconSprite);

      const root = document.createElement('div');
      root.id = 'react-scan-toolbar-root';
      root.className = 'absolute z-2147483647';

      fragment.appendChild(cssStyles);
      fragment.appendChild(root);

      shadowRoot.appendChild(fragment);

      document.documentElement.appendChild(container);

      ctx = initReactScanOverlay();
      if (!ctx) return;
      startFlushOutlineInterval(ctx);

      createInspectElementStateMachine(shadowRoot);
      unSubPerformanceListener?.();
      unSubPerformanceListener = setupPerformanceListener(async (entry) => {
        if (entry.duration < 200) return;

        const element = getElementFromPerformanceEntry(entry);
        if (!element) return;

        let rect = await batchGetBoundingRects([element]).then((map) =>
          map.get(element),
        );
        if (!rect) return;

        const existingActiveInteraction =
          ReactScanInternals.activeInteractionOutlines.get(element);

        if (existingActiveInteraction) {
          existingActiveInteraction.outline.frame =
            TOTAL_INTERACTION_OUTLINE_FRAMES;
        }

        const domInteraction = {
          kind: entry.type,
          outline: {
            alpha: 1,
            color: getColorFromPerformanceEntry(entry),
            frame: TOTAL_INTERACTION_OUTLINE_FRAMES,
            rect,
          },
          time: entry.duration,
          element,
        };

        ReactScanInternals.activeInteractionOutlines.set(
          element,
          domInteraction,
        );
        drawInteractionOutline(domInteraction, ctx!);
      });

      globalThis.__REACT_SCAN__ = {
        ReactScanInternals,
      };

      if (ReactScanInternals.options.value.showToolbar) {
        toolbarContainer = createToolbar(shadowRoot);
      }

      const existingOverlay = document.querySelector('react-scan-overlay');
      if (existingOverlay) {
        return;
      }
      const overlayElement = document.createElement('react-scan-overlay');

      document.documentElement.appendChild(overlayElement);

      logIntro();
    },
    onCommitStart() {
      ReactScanInternals.options.value.onCommitStart?.();
    },
    onError(error) {
      // eslint-disable-next-line no-console
      console.error('[React Scan] Error instrumenting:', error);
    },
    isValidFiber,
    onRender(fiber, renders) {
      // todo: don't track renders at all if paused, reduce overhead
      if (
        (Boolean(ReactScanInternals.instrumentation?.isPaused.value) &&
          (Store.inspectState.value.kind === 'inspect-off' ||
            Store.inspectState.value.kind === 'uninitialized')) ||
        !ctx ||
        document.visibilityState !== 'visible'
      ) {
        // don't draw if it's paused or tab is not active
        return;
      }
      updateFiberRenderData(fiber, renders);
      if (ReactScanInternals.options.value.log) {
        // this can be expensive given enough re-renders
        log(renders);
      }

      if (isCompositeFiber(fiber)) {
        // report render has a non trivial cost because it calls Date.now(), so we want to avoid the computation if possible
        if (
          ReactScanInternals.options.value.showToolbar !== false &&
          Store.inspectState.value.kind === 'focused'
        ) {
          reportRender(fiber, renders);
        }
      }

      ReactScanInternals.options.value.onRender?.(fiber, renders);

      updateScheduledOutlines(fiber, renders);
      for (let i = 0, len = renders.length; i < len; i++) {
        const render = renders[i];

        // - audio context can take up an insane amount of cpu, todo: figure out why
        // - we may want to take this out of hot path
        if (ReactScanInternals.options.value.playSound && audioContext) {
          const renderTimeThreshold = 10;
          const amplitude = Math.min(
            1,
            ((render.time ?? 0) - renderTimeThreshold) /
              (renderTimeThreshold * 2),
          );
          playGeigerClickSound(audioContext, amplitude);
        }
      }
    },
    onCommitFinish() {
      ReactScanInternals.options.value.onCommitFinish?.();
    },
    trackChanges: true,
  });

  ReactScanInternals.instrumentation = instrumentation;

  // TODO: add an visual error indicator that it didn't load
  if (!Store.monitor.value) {
    setTimeout(() => {
      if (isInstrumentationActive()) return;
      // eslint-disable-next-line no-console
      console.error(
        '[React Scan] Failed to load. Must import React Scan before React runs.',
      );
    }, 5000);
  }
};

export const withScan = <T>(
  component: React.ComponentType<T>,
  options: Options = {},
) => {
  setOptions(options);
  const isInIframe = Store.isInIframe.value;
  const componentAllowList = ReactScanInternals.componentAllowList;
  if (isInIframe || (options.enabled === false && options.showToolbar !== true))
    return component;
  if (!componentAllowList) {
    ReactScanInternals.componentAllowList = new WeakMap<
      React.ComponentType<any>,
      Options
    >();
  }
  if (componentAllowList) {
    componentAllowList.set(component, { ...options });
  }

  start();

  return component;
};

export const scan = (options: Options = {}) => {
  setOptions(options);
  const isInIframe = Store.isInIframe.value;
  if (isInIframe || (options.enabled === false && options.showToolbar !== true))
    return;

  start();
};

export const useScan = (options: Options = {}) => {
  setOptions(options);
  start();
};

export const onRender = (
  type: unknown,
  _onRender: (fiber: Fiber, renders: Array<Render>) => void,
) => {
  const prevOnRender = ReactScanInternals.onRender;
  ReactScanInternals.onRender = (fiber, renders) => {
    prevOnRender?.(fiber, renders);
    if (getType(fiber.type) === type) {
      _onRender(fiber, renders);
    }
  };
};

export const ignoredProps = new WeakSet<
  Exclude<
    React.ReactNode,
    undefined | null | string | number | boolean | bigint
  >
>();

export const ignoreScan = (node: React.ReactNode) => {
  if (typeof node === 'object' && node) {
    ignoredProps.add(node);
  }
};
