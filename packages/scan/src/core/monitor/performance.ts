import { getDisplayName, getTimings } from 'bippy';
import { type Fiber } from 'react-reconciler';
import { start, Store } from '../..';
import {
  getCompositeComponentFromElement,
  getFiberFromElement,
  getParentCompositeFiber,
} from '../web/inspect-element/utils';
import type {
  InternalInteraction,
  PerformanceInteraction,
  PerformanceInteractionEntry,
} from './types';
import {
  BoundedArray,
  createChildrenAdjacencyList,
  devError,
  devInvariant,
  iife,
} from 'src/core/monitor/performance-utils';
import {
  MAX_CHANNEL_SIZE,
  performanceEntryChannels,
} from 'src/core/monitor/performance-store';

interface PathFilters {
  skipProviders: boolean;
  skipHocs: boolean;
  skipContainers: boolean;
  skipMinified: boolean;
  skipUtilities: boolean;
  skipBoundaries: boolean;
}

const DEFAULT_FILTERS: PathFilters = {
  skipProviders: true,
  skipHocs: true,
  skipContainers: true,
  skipMinified: true,
  skipUtilities: true,
  skipBoundaries: true,
};


const FILTER_PATTERNS = {
  providers: [/Provider$/, /^Provider$/, /^Context$/],
  hocs: [/^with[A-Z]/, /^forward(?:Ref)?$/i, /^Forward(?:Ref)?\(/],
  containers: [/^(?:App)?Container$/, /^Root$/, /^ReactDev/],
  utilities: [
    /^Fragment$/,
    /^Suspense$/,
    /^ErrorBoundary$/,
    /^Portal$/,
    /^Consumer$/,
    /^Layout$/,
    /^Router/,
    /^Hydration/,
  ],
  boundaries: [/^Boundary$/, /Boundary$/, /^Provider$/, /Provider$/],
};

const shouldIncludeInPath = (
  name: string,
  filters: PathFilters = DEFAULT_FILTERS,
): boolean => {
  const patternsToCheck: Array<RegExp> = [];
  if (filters.skipProviders) patternsToCheck.push(...FILTER_PATTERNS.providers);
  if (filters.skipHocs) patternsToCheck.push(...FILTER_PATTERNS.hocs);
  if (filters.skipContainers)
    patternsToCheck.push(...FILTER_PATTERNS.containers);
  if (filters.skipUtilities) patternsToCheck.push(...FILTER_PATTERNS.utilities);
  if (filters.skipBoundaries)
    patternsToCheck.push(...FILTER_PATTERNS.boundaries);
  return !patternsToCheck.some((pattern) => pattern.test(name));
};

const minifiedPatterns = [
  /^[a-z]$/, // Single lowercase letter
  /^[a-z][0-9]$/, // Lowercase letter followed by number
  /^_+$/, // Just underscores
  /^[A-Za-z][_$]$/, // Letter followed by underscore or dollar
  /^[a-z]{1,2}$/, // 1-2 lowercase letters
];

const isMinified = (name: string): boolean => {
  if (!name || typeof name !== 'string') {
    return true;
  }

  for (let i = 0; i < minifiedPatterns.length; i++) {
    if (minifiedPatterns[i].test(name)) return true;
  }

  const hasNoVowels = !/[aeiou]/i.test(name);
  const hasMostlyNumbers = (name.match(/\d/g)?.length ?? 0) > name.length / 2;
  const isSingleWordLowerCase = /^[a-z]+$/.test(name);
  const hasRandomLookingChars = /[$_]{2,}/.test(name);

  // If more than 2 of the following are true, we consider the name minified
  return (
    Number(hasNoVowels) +
      Number(hasMostlyNumbers) +
      Number(isSingleWordLowerCase) +
      Number(hasRandomLookingChars) >=
    2
  );
};

export const getInteractionPath = (
  fiber: Fiber | null,
  filters: PathFilters = DEFAULT_FILTERS,
): Array<string> => {
  if (!fiber) {
    return [];
  }

  const stack = new Array<string>();
  let currentFiber = fiber;
  while (currentFiber.return) {
    const name = getCleanComponentName(currentFiber.type);

    if (name && !isMinified(name) && shouldIncludeInPath(name, filters)) {
      stack.push(name);
    }
    currentFiber = currentFiber.return;
  }

  const fullPath = new Array<string>(stack.length);
  for (let i = 0; i < stack.length; i++) {
    fullPath[i] = stack[stack.length - i - 1];
  }

  return fullPath;
};

let currentMouseOver: Element;

const getCleanComponentName = (
  component: any /** fiber.type is any */,
): string => {
  const name = getDisplayName(component);
  if (!name) return '';

  return name.replace(
    /^(?:Memo|Forward(?:Ref)?|With.*?)\((?<inner>.*?)\)$/,
    '$<inner>',
  );
};

// For future use, normalization of paths happens on server side now using path property of interaction
const _normalizePath = (path: Array<string>): string => {
  const cleaned = path.filter(Boolean);
  const deduped = cleaned.filter((name, i) => name !== cleaned[i - 1]);
  return deduped.join('.');
};

const handleMouseover = (event: Event) => {
  if (!(event.target instanceof Element)) return;
  currentMouseOver = event.target;
};

const getFirstNamedAncestorCompositeFiber = (element: Element) => {
  let curr: Element | null = element;
  let parentCompositeFiber: Fiber | null = null;
  while (!parentCompositeFiber && curr.parentElement) {
    curr = curr.parentElement;

    const { parentCompositeFiber: fiber } =
      getCompositeComponentFromElement(curr);

    if (!fiber) {
      continue;
    }
    if (getDisplayName(fiber?.type)) {
      parentCompositeFiber = fiber;
    }
  }
  return parentCompositeFiber;
};

const getFirstNameFromAncestor = (fiber: Fiber) => {
  let curr: Fiber | null = fiber;

  while (curr) {
    const currName = getDisplayName(curr.type);
    if (currName) {
      return currName;
    }

    curr = curr.return;
  }
  return null;
};

let unsubscribeTrackVisibilityChange: (() => void) | undefined;
// fixme: compress me if this stays here for bad interaction time checks
let lastVisibilityHiddenAt: number | 'never-hidden' = 'never-hidden';

const trackVisibilityChange = () => {
  unsubscribeTrackVisibilityChange?.();
  const onVisibilityChange = () => {
    if (document.hidden) {
      lastVisibilityHiddenAt = Date.now();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  unsubscribeTrackVisibilityChange = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
};
export type FiberRenders = Map<
  Fiber,
  {
    renderCount: number;
    // add self time/ total time later
  }
>;

type InteractionStartStage = {
  kind: 'interaction-start';
  interactionType: 'pointer' | 'keyboard';
  rrwebId: number;
  interactionUUID: string;
  interactionStartDetail: number;
  blockingTimeStart: number;
  componentPath: Array<string>;
  componentName: string;
  childrenTree: Record<
    string,
    { children: Array<string>; firstNamedAncestor: string; isRoot: boolean }
  >;
  fiberRenders: Record<
    string,
    {
      renderCount: number;
      parents: Set<string>;
      selfTime: number;
    }
  >;
  stopListeningForRenders: () => void;
};

type JSEndStage = Omit<InteractionStartStage, 'kind'> & {
  kind: 'js-end-stage';
  jsEndDetail: number;
};


type RAFStage = Omit<JSEndStage, 'kind'> & {
  kind: 'raf-stage';
  rafStart: number;
};

export type TimeoutStage = Omit<RAFStage, 'kind'> & {
  kind: 'timeout-stage';
  commitEnd: number;
  blockingTimeEnd: number;
};

export type CompletedInteraction = {
  detailedTiming: TimeoutStage;
  latency: number;
  completedAt: number;
  flushNeeded: boolean;
};

type UnInitializedStage = {
  kind: 'uninitialized-stage';
  interactionUUID: string;
  interactionType: 'pointer' | 'keyboard';
};

type CurrentInteraction = {
  kind: 'pointer' | 'keyboard';
  interactionUUID: string;
  pointerUpStart: number;
  // needed for when inputs that can be clicked and trigger on change (like checkboxes)
  clickChangeStart: number | null;
  clickHandlerMicroTaskEnd: number | null;
  rafStart: number | null;
  commmitEnd: number | null;
  timeorigin: number;

  // for now i don't trust performance now timing for UTC time...
  blockingTimeStart: number;
  blockingTimeEnd: number | null;
  fiberRenders: Map<
    string,
    {
      renderCount: number;
      parents: Set<string>;
      selfTime: number;
    }
  >;
  componentPath: Array<string>;
  componentName: string;
  childrenTree: Record<
    string,
    { children: Array<string>; firstNamedAncestor: string; isRoot: boolean }
  >;
};

export let currentInteractions: Array<CurrentInteraction> = [];
export const fastHash = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
};
const getInteractionType = (
  eventName: string,
): 'pointer' | 'keyboard' | null => {
  // todo: track pointer down, but tends to not house expensive logic so not very high priority
  if (['pointerup', 'click'].includes(eventName)) {
    return 'pointer';
  }
  if (eventName.includes('key')) {
    // console.log('event', eventName);
  }
  if (['keydown', 'keyup'].includes(eventName)) {
    return 'keyboard';
  }
  return null;
};
export const getInteractionId = (interaction: any) => {
  return `${interaction.performanceEntry.type}::${normalizePath(interaction.componentPath)}::${interaction.url}`;
};
export function normalizePath(path: string[]): string {
  const cleaned = path.filter(Boolean);

  const deduped = cleaned.filter((name, i) => name !== cleaned[i - 1]);

  return deduped.join('.');
}
let onEntryAnimationId: number | null = null;
const setupPerformanceListener = (
  onEntry: (interaction: PerformanceInteraction) => void,
) => {
  trackVisibilityChange();
  const interactionMap = new Map<string, PerformanceInteraction>();
  const interactionTargetMap = new Map<string, Element>();

  const processInteractionEntry = (entry: PerformanceInteractionEntry) => {
    if (!entry.interactionId) return;

    if (
      entry.interactionId &&
      entry.target &&
      !interactionTargetMap.has(entry.interactionId)
    ) {
      interactionTargetMap.set(entry.interactionId, entry.target);
    }

    const existingInteraction = interactionMap.get(entry.interactionId);

    if (existingInteraction) {
      if (entry.duration > existingInteraction.latency) {
        existingInteraction.entries = [entry];
        existingInteraction.latency = entry.duration;
      } else if (
        entry.duration === existingInteraction.latency &&
        entry.startTime === existingInteraction.entries[0].startTime
      ) {
        existingInteraction.entries.push(entry);
      }
    } else {
      const interactionType = getInteractionType(entry.name);
      if (!interactionType) {
        return;
      }

      const interaction: PerformanceInteraction = {
        id: entry.interactionId,
        latency: entry.duration,
        entries: [entry],
        target: entry.target,
        type: interactionType,
        startTime: entry.startTime,
        endTime: Date.now(),
        processingStart: entry.processingStart,
        processingEnd: entry.processingEnd,
        duration: entry.duration,
        inputDelay: entry.processingStart - entry.startTime,
        processingDuration: entry.processingEnd - entry.processingStart,
        presentationDelay:
          entry.duration - (entry.processingEnd - entry.startTime),
        timestamp: Date.now(),
        timeSinceTabInactive:
          lastVisibilityHiddenAt === 'never-hidden'
            ? 'never-hidden'
            : Date.now() - lastVisibilityHiddenAt,
        visibilityState: document.visibilityState,
        timeOrigin: performance.timeOrigin,
        referrer: document.referrer,
      };
      //
      interactionMap.set(interaction.id, interaction);


      /**
       * This seems odd, but it gives us determinism that we will receive an entry AFTER our detailed timing collection
       * runs because browser semantics (raf(() => setTimeout) will always run before a doubleRaf)
       *
       * this also handles the case where multiple entries are dispatched for semantically the same interaction,
       * they will get merged into a single interaction, where the largest latency is recorded, which is what
       * we are interested in this application
       */

      if (!onEntryAnimationId) {
        onEntryAnimationId = requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            onEntry(interactionMap.get(interaction.id)!);
            onEntryAnimationId = null;
          });
        });
      } 
    }
  };

  const po = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    for (let i = 0, len = entries.length; i < len; i++) {
      const entry = entries[i];
      processInteractionEntry(entry as PerformanceInteractionEntry);
    }
  });

  try {
    po.observe({
      type: 'event',
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit);
    po.observe({
      type: 'first-input',
      buffered: true,
    });
  } catch {
    /* Should collect error logs*/
  }

  return () => po.disconnect();
};

export const setupPerformancePublisher = () => {
  return setupPerformanceListener((entry) => {

    performanceEntryChannels.publish(entry, 'recording');
  });
};

// we should actually only feed it the information it needs to complete so we can support safari
type Task = {
  completeInteraction: (entry: PerformanceInteraction) => CompletedInteraction;
  startDateTime: number;
  endDateTime: number;
  type: 'keyboard' | 'pointer';
};
export const MAX_INTERACTION_TASKS = 25;

let tasks = new BoundedArray<Task>(MAX_INTERACTION_TASKS);

const getAssociatedDetailedTimingInteraction = (
  entry: PerformanceInteraction,
  activeTasks: Array<Task>,
) => {
  let closestTask: Task | null = null;
  for (const task of activeTasks) {
    if (task.type !== entry.type) {
      continue;
    }

    if (closestTask === null) {
      closestTask = task;
      continue;
    }

    const getAbsoluteDiff = (task: Task, entry: PerformanceInteraction) =>
      Math.abs(task.startDateTime) - (entry.startTime + entry.timeOrigin);

    if (getAbsoluteDiff(task, entry) < getAbsoluteDiff(closestTask, entry)) {
      closestTask = task;
    }
  }

  return closestTask;
};

// this would be cool if it listened for merge, so it had to be after
export const listenForPerformanceEntryInteractions = (
  onComplete: (completedInteraction: CompletedInteraction) => void,
) => {
  // we make the assumption that the detailed timing will be ready before the performance timing
  const unsubscribe = performanceEntryChannels.subscribe(
    'recording',
    (entry: PerformanceInteraction) => {
      const associatedDetailedInteraction =
        getAssociatedDetailedTimingInteraction(entry, tasks);

      // REMINDME: this likely means we clicked a non interactable thing but our handler still ran
      // so we shouldn't treat this as an invariant, but instead use it to verify if we clicked
      // something interactable
      if (!associatedDetailedInteraction) {
        console.log('dropped performance entry');

        return;
      }
      // handles the case where we capture an event the browser doesn't
      tasks = new BoundedArray(MAX_INTERACTION_TASKS);
      performanceEntryChannels.updateChannelState(
        'recording',
        (state: BoundedArray<PerformanceInteraction>) => {
          return BoundedArray.fromArray(
            BoundedArray.fromArray(
              // kill the previous detailed interactions not tracked by performance entry
              state.filter(
                (item) =>
                  item.startTime + item.timeOrigin >
                  entry.startTime + entry.timeOrigin,
              ),
              MAX_CHANNEL_SIZE,
            ),
            MAX_CHANNEL_SIZE,
          );
        },
      );
      const completedInteraction =
        associatedDetailedInteraction.completeInteraction(entry);
      onComplete(completedInteraction);
    },
  );

  return unsubscribe;
};


type ShouldContinue = boolean;
const trackDetailedTiming = ({
  onMicroTask,
  onRAF,
  onTimeout,
  abort,
}: {
  onMicroTask: () => ShouldContinue;
  onRAF: () => ShouldContinue;
  onTimeout: () => void;
  abort?: () => boolean;
}) => {
  queueMicrotask(() => {
    if (abort?.() === true) {
      return;
    }
    if (!onMicroTask()) {
      return;
    }
    requestAnimationFrame(() => {
      if (abort?.() === true) {
        return;
      }
      if (!onRAF()) {
        return;
      }
      setTimeout(() => {
        if (abort?.() === true) {
          return;
        }
        onTimeout();
      }, 0);
    });
  });
};

const getTargetInteractionDetails = (target: Element) => {
  const associatedFiber = getFiberFromElement(target);
  if (!associatedFiber) {
    return;
  }

  // TODO: if element is minified, squash upwards till first non minified ancestor, and set name as ChildOf(<parent-name>)
  let componentName = associatedFiber
    ? getDisplayName(associatedFiber?.type)
    : 'N/A';

  if (!componentName) {
    componentName = getFirstNameFromAncestor(associatedFiber) ?? 'N/A';
  }

  if (!componentName) {
    return;
  }

  const componentPath = getInteractionPath(associatedFiber);
  const childrenTree = collectFiberSubtree(associatedFiber);

  return {
    componentPath,
    childrenTree,
    componentName,
  };
};

type LastInteractionRef = {
  current: (
    | InteractionStartStage
    | JSEndStage
    | RAFStage
    | TimeoutStage
    | UnInitializedStage
  ) & { stageStart: number };
};

/**
 *
 * handles tracking event timings for arbitrarily overlapping handlers with cancel logic
 */
export const setupDetailedPointerTimingListener = (
  kind: 'pointer' | 'keyboard',
  options: {
    onStart?: (interactionUUID: string) => void;
    onComplete?: (
      interactionUUID: string,
      finalInteraction: {
        detailedTiming: TimeoutStage;
        latency: number;
        completedAt: number;
        flushNeeded: boolean;
      },
    ) => void;
    onError?: (interactionUUID: string) => void;
    getNodeID: (node: Node) => number;
  },
) => {
  let instrumentationIdInControl: string | null = null;

  const getEvent = (
    info: { phase: 'start' } | { phase: 'end'; target: Element },
  ) => {
    switch (kind) {
      case 'pointer': {
        if (info.phase === 'start') {
          return 'pointerup';
        }
        if (
          info.target instanceof HTMLInputElement ||
          info.target instanceof HTMLSelectElement
        ) {
          return 'change';
        }
        return 'click';
      }
      case 'keyboard': {
        if (info.phase === 'start') {
          return 'keydown';
        }

        return 'change';
      }
    }
  };
  const [startEvent, endEvent] =
    kind === 'pointer' ? ['pointerup', 'click'] : ['keydown', 'change'];

  console.log('[Performance] Setting up timing listener', {
    kind,
    startEvent,
    endEvent,
    instrumentationIdInControl,
  });


  // this implementation does not allow for overlapping interactions
  // getter/setter for debugging, doesn't do anything functional
  const lastInteractionRef: LastInteractionRef = {
    // @ts-expect-error
    _current: {
      kind: 'uninitialized-stage',
      interactionUUID: crypto.randomUUID(), // the first interaction uses this
      stageStart: Date.now(),
      interactionType: kind,
    },
    get current() {
      // @ts-expect-error
      return this._current;
    },
    set current(value) {
      // @ts-expect-error
      this._current = value;
    },
  };

  const onInteractionStart = (e: { target: Element }) => {

    if (Date.now() - lastInteractionRef.current.stageStart > 2000) {
      console.log('[Performance] Resetting stale state (>2s old)', {
        staleDuration: Date.now() - lastInteractionRef.current.stageStart,
        previousUUID: lastInteractionRef.current.interactionUUID,
        instrumentationIdInControl,
        fullState: lastInteractionRef.current,
      });
      lastInteractionRef.current = {
        kind: 'uninitialized-stage',
        interactionUUID: crypto.randomUUID(),
        stageStart: Date.now(),
        interactionType: kind,
      };
    }

    if (lastInteractionRef.current.kind !== 'uninitialized-stage') {
      return;
    }

    const pointerUpStart = performance.now();

    options?.onStart?.(lastInteractionRef.current.interactionUUID);
    const details = getTargetInteractionDetails(e.target as HTMLElement);

    if (!details) {
      options?.onError?.(lastInteractionRef.current.interactionUUID);
      return;
    }

    const fiberRenders: InteractionStartStage['fiberRenders'] = {};
    const stopListeningForRenders = listenForRenders(fiberRenders);
    lastInteractionRef.current = {
      ...lastInteractionRef.current,
      interactionType: kind,
      blockingTimeStart: Date.now(),
      childrenTree: details.childrenTree,
      componentName: details.componentName,
      componentPath: details.componentPath,
      fiberRenders,
      kind: 'interaction-start',
      interactionStartDetail: pointerUpStart,
      rrwebId: options.getNodeID(e.target),
      stopListeningForRenders,
    };


    const event = getEvent({ phase: 'end', target: e.target });
    document.addEventListener(event, onLastJS as any, {
      once: true,
    });

    // this is an edge case where a click event is not fired after a pointerdown
    // im not sure why this happens, but it seems to only happen on non intractable elements
    // it causes the event handler to stay alive until a future interaction, which can break timing (looks super long)
    // or invariants (the start metadata was removed, so now its an end metadata with no start)
    requestAnimationFrame(() => {
      document.removeEventListener(event as any, onLastJS as any);
    });
  };

  document.addEventListener(
    getEvent({ phase: 'start' }),
    onInteractionStart as any,
    {
      capture: true,
    },
  );

  const onLastJS = (
    e: { target: Element },
    instrumentationId: string,
    abort: () => boolean,
  ) => {

    if (
      lastInteractionRef.current.kind !== 'interaction-start' &&
      instrumentationId === instrumentationIdInControl
    ) {
      if (kind === 'pointer' && e.target instanceof HTMLSelectElement) {
        lastInteractionRef.current = {
          kind: 'uninitialized-stage',
          interactionUUID: crypto.randomUUID(),
          stageStart: Date.now(),
          interactionType: kind,
        };
        return;
      }

      options?.onError?.(lastInteractionRef.current.interactionUUID);
      lastInteractionRef.current = {
        kind: 'uninitialized-stage',
        interactionUUID: crypto.randomUUID(),
        stageStart: Date.now(),
        interactionType: kind,
      };
      devError('pointer -> click');
      return;
    }

    instrumentationIdInControl = instrumentationId;

    trackDetailedTiming({
      abort,
      onMicroTask: () => {

        if (lastInteractionRef.current.kind === 'uninitialized-stage') {
          return false;
        }

        lastInteractionRef.current = {
          ...lastInteractionRef.current,
          kind: 'js-end-stage',
          jsEndDetail: performance.now(),
        };
        return true;
      },
      onRAF: () => {
        if (
          lastInteractionRef.current.kind !== 'js-end-stage' &&
          lastInteractionRef.current.kind !== 'raf-stage'
        ) {
          console.log('[Performance] Invalid state in RAF', {
            currentStage: lastInteractionRef.current.kind,
            expectedStage: 'js-end-stage',
            interactionUUID: lastInteractionRef.current.interactionUUID,
            instrumentationIdInControl,
            fullState: lastInteractionRef.current,
          });
          options?.onError?.(lastInteractionRef.current.interactionUUID);
          devError('bad transition to raf');
          lastInteractionRef.current = {
            kind: 'uninitialized-stage',
            interactionUUID: crypto.randomUUID(),
            stageStart: Date.now(),
            interactionType: kind,
          };
          return false;
        }

        lastInteractionRef.current = {
          ...lastInteractionRef.current,
          kind: 'raf-stage',
          rafStart: performance.now(),
        };

        return true;
      },
      onTimeout: () => {
        if (lastInteractionRef.current.kind !== 'raf-stage') {
          console.log('[Performance] Invalid state in timeout', {
            currentStage: lastInteractionRef.current.kind,
            expectedStage: 'raf-stage',
            interactionUUID: lastInteractionRef.current.interactionUUID,
            instrumentationIdInControl,
            fullState: lastInteractionRef.current,
          });
          options?.onError?.(lastInteractionRef.current.interactionUUID);
          lastInteractionRef.current = {
            kind: 'uninitialized-stage',
            interactionUUID: crypto.randomUUID(),
            stageStart: Date.now(),
            interactionType: kind,
          };
          devError('raf->timeout');
          return;
        }
        const now = Date.now();
        const timeoutStage: TimeoutStage = Object.freeze({
          ...lastInteractionRef.current,
          kind: 'timeout-stage',
          blockingTimeEnd: now,
          commitEnd: performance.now(),
        });

        lastInteractionRef.current = {
          kind: 'uninitialized-stage',
          interactionUUID: crypto.randomUUID(),
          stageStart: now,
          interactionType: kind,
        };


        // this has to be the problem, i don't get how it's happening but timeOutStage is being mutated
        tasks.push({
          completeInteraction: (entry) => {
            console.log('[Performance] Completing interaction', {
              interactionUUID: timeoutStage.interactionUUID,
              latency: entry.latency,
              completedAt: Date.now(),
              instrumentationIdInControl,
              fullState: timeoutStage,
            });

            const finalInteraction = {
              detailedTiming: timeoutStage,
              latency: entry.latency,
              completedAt: Date.now(),
              flushNeeded: true,
            };
            options?.onComplete?.(timeoutStage.interactionUUID, finalInteraction);

            return finalInteraction;
          },
          endDateTime: Date.now(),
          startDateTime: timeoutStage.blockingTimeStart,
          type: kind,
        });
      },
    });
  };

  // const onBase = (e: { target: Element }) => {
  //   const id = crypto.randomUUID();
  //   onLastJS(e, id, () => id !== instrumentationIdInControl);
  // };
  // i forgot why this was needed, i needed to remember and document it
  // something about that event only sometimes firing, but it being later? I think?
  const onKeyPress = (e: { target: Element }) => {
    const id = crypto.randomUUID();
    onLastJS(e, id, () => id !== instrumentationIdInControl);
  };

  // document.addEventListener(getEvent({ phase: "start" }), onBase as any);
  if (kind === 'keyboard') {
    document.addEventListener('keypress', onKeyPress as any);
  }

  return () => {
    document.removeEventListener(
      getEvent({ phase: 'start' }),
      onInteractionStart as any,
      {
        capture: true,
      },
    );
    // document.removeEventListener(getEvent({}), onLastJS as any);
    document.removeEventListener('keypress', onKeyPress as any);
  };
};

const collectFiberSubtree = (fiber: Fiber) => {
  const adjacencyList = createChildrenAdjacencyList(fiber).entries();
  const fiberToNames = Array.from(adjacencyList).map(
    ([fiber, { children, parent, isRoot }]) => [
      getDisplayName(fiber.type) ?? 'N/A',
      {
        children: children.map((fiber) => getDisplayName(fiber.type) ?? 'N/A'),
        firstNamedAncestor: parent
          ? (getFirstNameFromAncestor(parent) ?? 'No Parent')
          : 'No Parent',
        isRoot,
      },
    ],
  );

  return Object.fromEntries(fiberToNames);
};

const listenForRenders = (
  fiberRenders: InteractionStartStage['fiberRenders'],
) => {
  const listener = (fiber: Fiber) => {
    const displayName = getDisplayName(fiber.type);
    if (!displayName) {
      return;
    }
    const existing = fiberRenders[displayName];
    if (!existing) {
      const parents = new Set<string>();
      const parentCompositeName = getDisplayName(
        getParentCompositeFiber(fiber),
      );
      if (parentCompositeName) {
        parents.add(parentCompositeName);
      }
      const { selfTime, totalTime } = getTimings(fiber);
      fiberRenders[displayName] = {
        renderCount: 1,
        parents: parents,
        selfTime,
      };
      return;
    }
    const parentType = getParentCompositeFiber(fiber)?.[0]?.type;
    if (parentType) {
      const parentCompositeName = getDisplayName(parentType);
      if (parentCompositeName) {
        existing.parents.add(parentCompositeName);
      }
    }
    const { selfTime  } = getTimings(fiber);
    existing.renderCount += 1;
    existing.selfTime += selfTime;
  };
  // todo: we need a general listener
  Store.monitor.value!.interactionListeningForRenders = listener;

  return () => {
    if (Store.monitor.value?.interactionListeningForRenders === listener) {
      Store.monitor.value.interactionListeningForRenders = null;
    }
  };
};
