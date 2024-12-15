import type { Fiber, FiberRoot } from 'react-reconciler';
import {
  getTimings,
  hasMemoCache,
  traverseContexts,
  traverseState,
  instrument,
  createFiberVisitor,
  getDisplayName,
  getType,
  isValidElement,
  getNearestHostFiber,
  didFiberCommit,
  getMutatedHostFibers,
} from 'bippy';
import { type Signal, signal } from '@preact/signals';
import { ReactScanInternals } from './index';

let fps = 0;
let lastTime = performance.now();
let frameCount = 0;
let initedFps = false;

export const getFPS = () => {
  const updateFPS = () => {
    frameCount++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
      fps = frameCount;
      frameCount = 0;
      lastTime = now;
    }
    requestAnimationFrame(updateFPS);
  };

  if (!initedFps) {
    initedFps = true;
    updateFPS();
    fps = 60;
  }

  return fps;
};

const truncateFloat = (value: number, maxLen = 10000 /* 4 digits */) => {
  if (
    typeof value === 'number' &&
    parseInt(value as any) !== value /* float check */
  ) {
    value = ~~(value * maxLen) / maxLen;
  }
  return value;
};

const THRESHOLD_FPS = 60;

export const getUnnecessaryScore = (fiber: Fiber) => {
  const hostFiber = getNearestHostFiber(fiber);
  if (!hostFiber) return 0;
  const isVisible =
    isElementVisible(hostFiber.stateNode) && !didFiberCommit(fiber);

  let unnecessaryScore = isVisible ? 0 : 1;
  if (unnecessaryScore === 0) {
    const mutatedHostFibers = getMutatedHostFibers(fiber);
    for (const mutatedHostFiber of mutatedHostFibers) {
      const node = mutatedHostFiber.stateNode;
      if (!isElementVisible(node) || didFiberCommit(node)) {
        unnecessaryScore += 1 / mutatedHostFibers.length;
      }
    }
  }
  return truncateFloat(unnecessaryScore);
};

export const getSlowScore = () => {
  // TODO: add interaction check (if interaction occured, then rank it more important)
  const fps = getFPS();
  return fps < THRESHOLD_FPS
    ? truncateFloat((THRESHOLD_FPS - fps) / THRESHOLD_FPS)
    : 0;
};

export const isElementVisible = (el: HTMLElement) => {
  const style = window.getComputedStyle(el);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.contentVisibility !== 'hidden' &&
    style.opacity !== '0'
  );
};

let initedEventListeners = false;
let scrollX: number | null = null;
let scrollY: number | null = null;
let innerWidth: number | null = null;
let innerHeight: number | null = null;

export const getWindowDimensions = () => {
  if (scrollX === null) scrollX = window.scrollX;
  if (scrollY === null) scrollY = window.scrollY;
  if (innerWidth === null) innerWidth = window.innerWidth;
  if (innerHeight === null) innerHeight = window.innerHeight;

  if (!initedEventListeners) {
    initedEventListeners = true;
    const handleResize = () => {
      scrollX = null;
      scrollY = null;
      innerWidth = null;
      innerHeight = null;
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize);
  }
  return {
    top: scrollY,
    left: scrollX,
    right: scrollX + innerWidth,
    bottom: scrollY + innerHeight,
  };
};

export const isElementInViewport = (el: HTMLElement) => {
  const elTop = el.offsetTop;
  const elLeft = el.offsetLeft;
  const elWidth = el.offsetWidth;
  const elHeight = el.offsetHeight;
  const { top, left, right, bottom } = getWindowDimensions();

  return (
    elTop + elHeight > top &&
    elLeft + elWidth > left &&
    elTop < bottom &&
    elLeft < right
  );
};

export interface Change {
  type: 'props' | 'context' | 'state';
  name: string;
  prevValue: unknown;
  nextValue: unknown;
  unstable: boolean;
}

export type Category = 'slow' | 'unnecessary' | 'offscreen';

export interface Render {
  phase: string;
  componentName: string | null;
  time: number;
  count: number;
  forget: boolean;
  changes: Array<Change> | null;
  score: number;
}

const unstableTypes = ['function', 'object'];

export const fastSerialize = (value: unknown) => {
  switch (typeof value) {
    case 'function':
      return value.toString();
    case 'string':
      return value;
    case 'object':
      if (value === null) {
        return 'null';
      }
      if (Array.isArray(value)) {
        return value.length > 0 ? '[…]' : '[]';
      }
      if (isValidElement(value)) {
        // attempt to extract some name from the component
        return `<${getDisplayName(value.type) ?? ''}${
          Object.keys(value.props || {}).length > 0 ? ' …' : ''
        }>`;
      }
      if (
        typeof value === 'object' &&
        value !== null &&
        value.constructor === Object
      ) {
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            return '{…}';
          }
        }
        return '{}';
      }
      // eslint-disable-next-line no-case-declarations
      const tagString = Object.prototype.toString.call(value).slice(8, -1);
      if (tagString === 'Object') {
        const proto = Object.getPrototypeOf(value);
        const constructor = proto?.constructor;
        if (typeof constructor === 'function') {
          return `${constructor.displayName || constructor.name || ''}{…}`;
        }
      }
      return `${tagString}{…}`;
    default:
      return String(value);
  }
};

export const getPropsChanges = (fiber: Fiber) => {
  const changes: Array<Change> = [];

  const prevProps = fiber.alternate?.memoizedProps;
  const nextProps = fiber.memoizedProps;

  for (const propName in { ...prevProps, ...nextProps }) {
    const prevValue = prevProps?.[propName];
    const nextValue = nextProps?.[propName];

    if (
      Object.is(prevValue, nextValue) ||
      isValidElement(prevValue) ||
      isValidElement(nextValue)
    ) {
      continue;
    }
    const change: Change = {
      type: 'props',
      name: propName,
      prevValue,
      nextValue,
      unstable: false,
    };
    changes.push(change);

    const prevValueString = fastSerialize(prevValue);
    const nextValueString = fastSerialize(nextValue);

    if (
      !unstableTypes.includes(typeof prevValue) ||
      !unstableTypes.includes(typeof nextValue) ||
      prevValueString !== nextValueString
    ) {
      continue;
    }

    change.unstable = true;
  }

  return changes;
};

export const getStateChanges = (fiber: Fiber) => {
  const changes: Array<Change> = [];

  traverseState(fiber, (prevState, nextState) => {
    if (Object.is(prevState.memoizedState, nextState.memoizedState)) return;
    const change: Change = {
      type: 'state',
      name: '',
      prevValue: prevState.memoizedState,
      nextValue: nextState.memoizedState,
      unstable: false,
    };
    changes.push(change);
  });

  return changes;
};

export const getContextChanges = (fiber: Fiber) => {
  const changes: Array<Change> = [];

  traverseContexts(fiber, (prevContext, nextContext) => {
    const prevValue = prevContext.memoizedValue;
    const nextValue = nextContext.memoizedValue;

    const change: Change = {
      type: 'context',
      name: '',
      prevValue,
      nextValue,
      unstable: false,
    };
    changes.push(change);

    const prevValueString = fastSerialize(prevValue);
    const nextValueString = fastSerialize(nextValue);

    if (
      unstableTypes.includes(typeof prevValue) &&
      unstableTypes.includes(typeof nextValue) &&
      prevValueString === nextValueString
    ) {
      change.unstable = true;
    }
  });

  return changes;
};

type OnRenderHandler = (fiber: Fiber, renders: Array<Render>) => void;
type OnCommitStartHandler = () => void;
type OnCommitFinishHandler = () => void;
type OnErrorHandler = (error: unknown) => void;
type IsValidFiberHandler = (fiber: Fiber) => boolean;

interface InstrumentationConfig {
  onCommitStart: OnCommitStartHandler;
  isValidFiber: IsValidFiberHandler;
  onRender: OnRenderHandler;
  onCommitFinish: OnCommitFinishHandler;
  onError: OnErrorHandler;
}

interface InstrumentationInstance {
  key: string;
  config: InstrumentationConfig;
  instrumentation: Instrumentation;
}

interface Instrumentation {
  isPaused: Signal<boolean>;
  fiberRoots: Set<FiberRoot>;
}

const instrumentationInstances = new Map<string, InstrumentationInstance>();
let inited = false;

const getAllInstances = () => Array.from(instrumentationInstances.values());

export const createInstrumentation = (
  instanceKey: string,
  config: InstrumentationConfig,
) => {
  const instrumentation: Instrumentation = {
    // this will typically be false, but in cases where a user provides showToolbar: true, this will be true
    isPaused: signal(!ReactScanInternals.options.value.enabled),
    fiberRoots: new Set<FiberRoot>(),
  };
  instrumentationInstances.set(instanceKey, {
    key: instanceKey,
    config,
    instrumentation,
  });
  if (!inited) {
    inited = true;
    const visitor = createFiberVisitor({
      onRender(fiber, phase) {
        const type = getType(fiber.type);
        if (!type) return null;

        const allInstances = getAllInstances();
        const validInstancesIndicies: Array<number> = [];
        for (let i = 0, len = allInstances.length; i < len; i++) {
          const instance = allInstances[i];
          if (!instance.config.isValidFiber(fiber)) continue;
          validInstancesIndicies.push(i);
        }
        if (!validInstancesIndicies.length) return null;

        const changes: Array<Change> = [];

        const propsChanges = getPropsChanges(fiber);
        const stateChanges = getStateChanges(fiber);
        const contextChanges = getContextChanges(fiber);

        changes.push(...propsChanges);
        changes.push(...stateChanges);
        changes.push(...contextChanges);

        const { selfTime } = getTimings(fiber);

        const render: Render = {
          phase,
          componentName: getDisplayName(type),
          count: 1,
          changes,
          time: selfTime,
          forget: hasMemoCache(fiber),
          score: getSlowScore(),
        };

        for (let i = 0, len = validInstancesIndicies.length; i < len; i++) {
          const index = validInstancesIndicies[i];
          const instance = allInstances[index];
          instance.config.onRender(fiber, [render]);
        }
      },
      onError(error) {
        const allInstances = getAllInstances();
        for (const instance of allInstances) {
          instance.config.onError(error);
        }
      },
    });
    instrument({
      name: 'react-scan',
      onCommitFiberRoot: (rendererID, root) => {
        const allInstances = getAllInstances();
        for (const instance of allInstances) {
          instance.config.onCommitStart();
        }
        visitor(rendererID, root);
        for (const instance of allInstances) {
          instance.config.onCommitFinish();
        }
      },
    });
  }
  return instrumentation;
};
