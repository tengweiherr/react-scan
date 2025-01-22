import { eventWithTime } from "@rrweb/types";
import { OutlineKey, ReactScanInternals } from "../..";
import { Fiber } from "react-reconciler";
import { createInstrumentation, listenToFps } from "../../instrumentation";
import { getDisplayName, getNearestHostFiber, getTimings } from "bippy";
import { onIdle } from "@web-utils/helpers";
import {
  CompletedInteraction,
  listenForPerformanceEntryInteractions,
  setupDetailedPointerTimingListener,
  setupPerformancePublisher,
  TimeoutStage,
} from "src/core/monitor/performance";
import {
  MAX_CHANNEL_SIZE,
  performanceEntryChannels,
} from "src/core/monitor/performance-store";
import {
  BoundedArray,
  devInvariant,
  iife,
} from "src/core/monitor/performance-utils";
import { PerformanceInteraction } from "src/core/monitor/types";
import {
  interactionStore,
  MAX_INTERACTION_BATCH,
} from "src/core/monitor/interaction-store";
import {
  convertInteractionFiberRenderParents,
  InteractionWithArrayParents,
} from "../network";

export let rrwebEvents: Array<eventWithTime> = [];
let timing: { startTime: number } = {
  startTime: Date.now(),
};

const PLUGIN = 6;

type BufferedScheduledOutline = {
  renderCount: number;
  selfTime: number;
  fiber: Fiber;
};

const bufferedFiberRenderMap = new Map<number, BufferedScheduledOutline>();

const addToBufferedFiberRenderMap = (fiber: Fiber) => {
  const fiberId = getFiberId(fiber);
  const existing = bufferedFiberRenderMap.get(fiberId);
  const { selfTime } = getTimings(fiber);

  if (!existing) {
    bufferedFiberRenderMap.set(fiberId, {
      renderCount: 1,
      selfTime: selfTime,
      fiber,
    });
    return;
  }

  bufferedFiberRenderMap.set(fiberId, {
    renderCount: existing.renderCount + 1,
    selfTime: existing.selfTime + selfTime,
    fiber,
  });
};

export const makeEvent = (
  payload: unknown,
  plugin?: string
): eventWithTime => ({
  type: PLUGIN,
  data: {
    plugin: plugin ?? "react-scan-plugin",
    payload,
  },
  timestamp: Date.now(),
});
type listenerHandler = () => void;
let recordingInstance: listenerHandler | undefined = undefined;
let record: (typeof import("rrweb"))["record"] | null = null;

export const getEvents = () => rrwebEvents;

const initRRWeb = async () => {
  if (!record) {
    const rrwebPkg = await import("rrweb");
    record = rrwebPkg.record;
  }
  return record;
};

export const startNewRecording = async () => {
  console.log("new recording start");

  lastRecordTime = Date.now();

  const recordFn = await initRRWeb();

  if (recordingInstance) {
    recordingInstance();
  }
  rrwebEvents.length = 0;
  timing.startTime = Date.now();

  recordingInstance = recordFn({
    emit: (event: eventWithTime) => {
      rrwebEvents.push(event);
    },
  });
};
type ReplayAggregatedRender = {
  name: ComponentName;
  frame: number | null;
  computedKey: OutlineKey | null;
  aggregatedCount: number;
};

type FiberId = number;

type ComponentName = string;
export type ReactScanPayload = Array<{
  rrwebDomId: number;
  renderCount: number;
  fiberId: number;
  componentName: string;

  selfTime: number;

  groupedAggregatedRender?: Map<FiberId, ReplayAggregatedRender>;

  /* Rects for interpolation */
  current?: DOMRect;
  target?: DOMRect;
  /* This value is computed before the full rendered text is shown, so its only considered an estimate */
  estimatedTextWidth?: number; // todo: estimated is stupid just make it the actual

  alpha?: number | null;
  totalFrames?: number | null;
}>;

let lastFiberId = 0;
const fiberIdMap = new Map<Fiber, number>();
const getFiberId = (fiber: Fiber) => {
  const existing = fiberIdMap.get(fiber);

  const inc = () => {
    lastFiberId++;
    fiberIdMap.set(fiber, lastFiberId);

    return lastFiberId;
  };
  if (existing) {
    return inc();
  }

  if (fiber.alternate) {
    const existing = fiberIdMap.get(fiber.alternate);
    if (existing) {
      return inc();
    }
  }

  lastFiberId++;

  fiberIdMap.set(fiber, lastFiberId);

  return lastFiberId;
};

const makeReactScanPayload = (
  buffered: Map<number, BufferedScheduledOutline>
): ReactScanPayload => {
  const payload: ReactScanPayload = [];
  buffered.forEach(({ renderCount, fiber, selfTime }) => {
    const stateNode = getNearestHostFiber(fiber)?.stateNode;
    if (!stateNode) {
      return;
    }

    const rrwebId = record!.mirror.getId(stateNode);
    if (rrwebId === -1) {
      return;
    }

    payload.push({
      renderCount,
      rrwebDomId: rrwebId,
      componentName: getDisplayName(fiber.type) ?? "N/A",
      fiberId: getFiberId(fiber),
      selfTime,
    });
  });
  return payload;
};

let interval: ReturnType<typeof setInterval>;
const startFlushRenderBufferInterval = () => {
  clearInterval(interval);
  interval = setInterval(() => {
    if (bufferedFiberRenderMap.size === 0) {
      return;
    }

    const payload = makeReactScanPayload(bufferedFiberRenderMap);

    rrwebEvents.push(makeEvent(payload));
    bufferedFiberRenderMap.clear();
  }, 75);
};

const fpsDiffs: Array<[fps: number, changedAt: number]> = [];

let lastInteractionTime: null | number = null;

type ReactScanMetaPayload =
  | {
      kind: "interaction-start";
      interactionUUID: string;
      dateNowTimestamp: number;
    }
  | {
      kind: "interaction-end";
      interactionUUID: string;
      dateNowTimestamp: number;
      memoryUsage: number | null;
    }
  | {
      kind: "fps-update";
      dateNowTimestamp: number;
      fps: number;
    };

export const makeMetaEvent = (payload: ReactScanMetaPayload) =>
  makeEvent(payload, "react-scan-meta");

export type SerializableFlushPayload = Omit<FlushPayload, "interactions"> & {
  interactions: Array<InteractionWithArrayParents>;
};

type FlushPayload = {
  events: Array<eventWithTime>;
  interactions: Array<CompletedInteraction>;
  fpsDiffs: any;
  startAt: number;
  completedAt: number;
};

export const flushInvariant = (payload: SerializableFlushPayload) => {
  // devInvariant(
  //   payload.events[0].type === 4,
  //   "first rrweb event must be meta event"
  // );
  if (payload.events[0].type !== 4) {
    console.warn("hm", payload);
  }
  // todo: reset state when invariant is violated
  payload.interactions.forEach(() => {
    const startEndEvents = payload.events.filter((event) => {
      if (event.type !== 6) {
        return;
      }
      if (event.data.plugin !== "react-scan-meta") {
        return;
      }
      const payload = event.data.payload as ReactScanMetaPayload;
      if (payload.kind === "fps-update") {
        return;
      }
      return true;
    });

    const eventMapping = new Map<`${string}$${string}`, number>();

    startEndEvents.forEach((value) => {
      const data = (value.data as any).payload as ReactScanMetaPayload;
      if (data.kind === "fps-update") {
        return;
      }

      let existingCount = eventMapping.get(
        `${data.kind}$${data.interactionUUID}`
      );
      if (existingCount) {
        eventMapping.set(
          `${data.kind}$${data.interactionUUID}`,
          existingCount + 1
        );
        return;
      }

      eventMapping.set(`${data.kind}$${data.interactionUUID}`, 1);
    });

    console.log("Event mapping data", eventMapping);

    eventMapping.forEach((value, key) => {
      // devInvariant(value === 1);
      const [kind, uuid] = key.split("$");

      const associatedKind =
        kind === "interaction-start" ? "interaction-end" : "interaction-start";

      const associatedEvent = eventMapping.get(`${associatedKind}$${uuid}`);
    });
  });
};

/**
 * we push a task to flush the recording
 *
 * that means we should use the store and channels
 */

const recordingTasks: Array<{
  flush: () => void;
  interactionUUIDs: Array<string>;
}> = [];

// this function handles flushing any tasks that are ready to be sent
const flushUploadedRecordingTasks = (tasks: typeof recordingTasks) => {
  const completedInteractions = (
    performanceEntryChannels.getChannelState("flushed-interactions") as Array<
      Array<string>
    >
  ).flat();

  tasks.forEach(({ interactionUUIDs, flush }) => {
    if (
      interactionUUIDs.every((uuid) => completedInteractions.includes(uuid))
    ) {
      // no longer needed, so we can clean them up from the channel state
      performanceEntryChannels.updateChannelState(
        "flushed-interactions",
        (state: BoundedArray<BoundedArray<string>>) => {
          return BoundedArray.fromArray(
            state.map((inner) =>
              BoundedArray.fromArray(
                inner.filter((uuid) => !interactionUUIDs.includes(uuid)),
                MAX_CHANNEL_SIZE
              )
            ),
            MAX_CHANNEL_SIZE
          );
        }
      );

      flush();
    }
  });
};

const setupFlushedInteractionsListener = () => {
  return performanceEntryChannels.subscribe("flushed-interactions", () => {
    flushUploadedRecordingTasks(recordingTasks);
  });
};

const getMemoryMB = () => {
  if (!("memory" in performance)) {
    return;
  }
  try {
    // @ts-expect-error
    if (performance?.memory?.usedJSHeapSize > 0) {
      // @ts-expect-error
      return Math.round(performance.memory.usedJSHeapSize / 1048576);
    }
    return null;
  } catch {
    return null;
  }
};

export const scanWithRecord = () => {
  const unSubPerformance = setupPerformancePublisher();
  const unSubFlushedInteractions = setupFlushedInteractionsListener();
  const onStart = (interactionUUID: string) => {
    rrwebEvents.push(
      makeMetaEvent({
        kind: "interaction-start",
        interactionUUID,
        dateNowTimestamp: Date.now(), // should use performance now but easier to get that wrong, so that's a future optimization
      })
    );
    console.log("pushed rrweb start event", rrwebEvents);
    countMeta(rrwebEvents);
  };

  const onComplete = async (
    interactionUUID: string,
    finalInteraction: {
      detailedTiming: TimeoutStage;
      latency: number;
      completedAt: number;
      flushNeeded: boolean;
    }
  ) => {
    lastInteractionTime = Date.now();
    const existingCompletedInteractions =
      performanceEntryChannels.getChannelState(
        "recording"
      ) as Array<PerformanceInteraction>;

    finalInteraction.detailedTiming.stopListeningForRenders();

    rrwebEvents.push(
      makeMetaEvent({
        kind: "interaction-end",
        interactionUUID,
        dateNowTimestamp: Date.now(), // should use performance now but easier to get that wrong, so that's a future optimization
        memoryUsage: getMemoryMB() ?? null,
      })
    );

    console.log("pushed rrweb end event", rrwebEvents);
    countMeta(rrwebEvents);
    if (existingCompletedInteractions.length) {
      // then performance entry and our detailed timing handlers are out of sync, we disregard that entry
      // it may be possible the performance entry returned before detailed timing. If that's the case we should update
      // assumptions and deal with mapping the entry back to the detailed timing here
      performanceEntryChannels.updateChannelState(
        "recording",
        () => new BoundedArray(MAX_CHANNEL_SIZE)
      );
    }
  };
  const unSubDetailedPointerTiming = setupDetailedPointerTimingListener(
    "pointer",
    {
      onStart,
      onComplete,
      getNodeID: (node) => record?.mirror.getId(node)!,
    }
  );
  const unSubDetailedKeyboardTiming = setupDetailedPointerTimingListener(
    "keyboard",
    {
      onStart,
      onComplete,
      getNodeID: (node) => record?.mirror.getId(node)!,
    }
  );

  const unSubFps = listenToFps((fps) => {
    const event = makeMetaEvent({
      kind: "fps-update",
      dateNowTimestamp: Date.now(),
      fps,
    });

    rrwebEvents.push(event);
    logFPSUpdates(rrwebEvents);
  });
  const unSubInteractions = listenForPerformanceEntryInteractions(
    (completedInteraction) => {
      interactionStore.setState(
        BoundedArray.fromArray(
          interactionStore.getCurrentState().concat(completedInteraction),
          MAX_INTERACTION_BATCH
        )
      );
      countMeta(rrwebEvents);
    }
  );

  startNewRecording();

  startFlushRenderBufferInterval();

  ReactScanInternals.instrumentation = createInstrumentation(
    "react-scan-session-replay",
    {
      onRender: (fiber) => {
        addToBufferedFiberRenderMap(fiber);
      },
      isValidFiber: () => true,

      onCommitStart() {
        ReactScanInternals.options.value.onCommitStart?.();
      },
      onCommitFinish() {
        ReactScanInternals.options.value.onCommitFinish?.();
      },

      onError: () => {},
      trackChanges: false,
      forceAlwaysTrackRenders: true,
    }
  );

  const stopInterval = setDebouncedInterval(
    () => {
      countMeta(rrwebEvents, "prequeue flush start");
      logFPSUpdates(rrwebEvents);
      console.log(
        "[Interval Callback]: before filters",
        interactionStore.getCurrentState(),
        rrwebEvents
      );
      rrwebEvents = removeUnusableMetadata(rrwebEvents);
      countMeta(rrwebEvents, "post filter pre quue flush start");
      interactionStore.setState(
        BoundedArray.fromArray(
          removeUnusableInteractions(
            interactionStore.getCurrentState(),
            rrwebEvents[0].timestamp
          ),
          MAX_INTERACTION_BATCH
        )
      );
      console.log(
        "[Interval Callback]: running",
        rrwebEvents,
        interactionStore.getCurrentState()
      );

      queueFlush();
    },
    () => {
      const now = Date.now();
      rrwebEvents = removeOldUnmatchedInteractionsFromMetadata(rrwebEvents);
      removeInteractionsBeforeRecordingStart();
      if (!rrwebEvents.length) {
        console.log("[Interval Early Return]: no events");

        // at minimum we want to wait for 3 seconds before and after the clip, so we should debounce for >6000ms
        return 7000;
      } /**
       * NOTE: this may seem incorrect since the session replay is lastEventTimeStamp - firstEventTimestamp long, but
       * we will fill the time difference with white space in puppeteer. It's only valid to add this white space if
       * we are sure there is inactivity, and in this case we are since the difference between Date.now() and last event
       * is the inactive time
       */
      const recordStart = rrwebEvents[0].timestamp;
      console.log("the first event is", rrwebEvents[0]);

      if (now - recordStart > 25_000) {
        onIdle(() => {
          startNewRecording();
        });

        return false;
      }
      if (!lastInteractionTime) {
        console.log("[Interval Early Return]: no interaction");
        return 7000;
      }

      if (now - lastInteractionTime < 2000) {
        console.log("[Interval Early Return]: interaction too close");
        return 5000;
      }
      // always flush if the recording is 25 seconds old

      // if we can flush at 15 seconds we wil, but if an interaction happens at the end
      // of the recording we will keep pushing back the recording till it hits 25 seconds
      if (now - recordStart > 15_000) {
        console.log("time since record", now - recordStart);

        if (now - lastInteractionTime < 3000) {
          console.log("[Interval Early Return]: push window back 3 seconds");
          return 3000;
        }

        // ;

        return false;
      }

      // it's possible an interaction is on going since the main thread could be unblocked before the frame is drawn
      // if instead there are interaction details on a fake interaction, then the GC at the start of the interval will clean it up in due time
      const ongoingInteraction = iife(() => {
        let startCount = 0;
        let endCount = 0;
        for (const event of rrwebEvents) {
          ifScanMeta(event, (payload) => {
            switch (payload.kind) {
              case "interaction-start": {
                startCount++;
                return;
              }
              case "interaction-end": {
                endCount++;
                return;
              }
            }
          });
        }
        return startCount !== endCount;
      });

      if (ongoingInteraction) {
        console.log("[Interval Early Return]: ongoing interaction");
        return 4000;
      }

      const timeSinceLastInteractionComplete = now - lastInteractionTime;
      if (timeSinceLastInteractionComplete < 4000) {
        console.log(
          "[Interval Early Return]: capturing more of end window for clip"
        );
        return timeSinceLastInteractionComplete;
      }

      console.log("[Interval Early Return]: just flush then");
      return false;
    }
  );

  return () => {
    unSubPerformance();
    unSubFlushedInteractions();
    unSubDetailedPointerTiming();
    unSubFps();
    unSubInteractions();
    unSubFlushedInteractions();
    stopInterval();
    unSubDetailedKeyboardTiming();
  };
};

const logFPSUpdates = (events: Array<eventWithTime>) => {
  // console.group("fps-updates");
  // const fps = events.filter((event) => {
  //   if (event.type !== 6 || event.data.plugin !== "react-scan-meta") {
  //     return;
  //   }
  //   const payload = event.data.payload as ReactScanMetaPayload;
  //   if (payload.kind === "fps-update") {
  //     console.log(event);
  //     return true;
  //   }
  // });
  // if (fps.length === 0) {
  //   console.log("no fps updates");
  // }
  // console.groupEnd();
};

// todo, slight race in timing when really close to start or end, so should give leniancy in the race
const logVideoAndInteractionMetadata = (
  interactions: Array<InteractionWithArrayParents>,
  events: Array<eventWithTime>
) => {
  console.group("log-video-meta");

  const start = events[0].timestamp;
  console.log("video is:", events.at(-1)?.timestamp! - start, "ms long");
  console.log("inactivity time is:", Date.now() - events.at(-1)?.timestamp!);
  console.log("the first event is", events[0]);
  console.log(
    "just incase, here is the delay",
    events[0].delay,
    events.at(-1)?.delay
  );

  interactions.forEach((interaction, index) => {
    console.log(
      "The",
      index + 1,
      "interaction occurred at",
      interaction.completedAt - start,
      "ms in the video"
    );
  });

  console.groupEnd();
};

// turn this into a recursive timeout so we can run onIdle and then call 10 seconds later
let lastRecordTime: number = Date.now(); // this is a valid initializer since it represents the earliest time flushing was possible, and lets us calculate the amount of time has passed since it's been possible to flush
type DebounceTime = number;

export const ifScanMeta = <T, R>(
  event: eventWithTime,
  then?: (payload: ReactScanMetaPayload) => T,
  otherwise?: R
): T | R | undefined => {
  if (event.type === 6 && event.data.plugin === "react-scan-meta") {
    return then?.(event.data.payload as ReactScanMetaPayload);
  }

  return otherwise;
};
export const removeUnusableInteractions = (
  interactions: Array<CompletedInteraction>,
  recordStart: number
) => {
  return interactions.filter((interaction) => {
    if (interaction.completedAt < recordStart) {
      console.log(
        "[Interaction Filter]: interaction happened before recording",
        interaction,
        recordStart
      );

      return false;
    }

    if (interaction.completedAt - recordStart < 2000) {
      console.log(
        "[Interaction Filter]: interaction happened less than 2 seconds from start",
        interaction,
        recordStart
      );
      return false;
    }
    if (Date.now() - interaction.completedAt < 2000) {
      console.log(
        "[Interaction Filter]: interaction happened less than 2 seconds from the current point in time",
        interaction,
        recordStart
      );
      return false;
    }
    return true;
  });
};

const eventIsUnmatched = (
  event: eventWithTime,
  events: Array<eventWithTime>
) => {
  if (event.type !== 6 || event.data.plugin !== "react-scan-meta") {
    return false;
  }

  const payload = event.data.payload as ReactScanMetaPayload;
  if (payload.kind === "fps-update") {
    return false;
  }

  const hasMatch = events.some((matchSearchEvent) => {
    if (
      matchSearchEvent.type !== 6 ||
      matchSearchEvent.data.plugin !== "react-scan-meta"
    ) {
      return false;
    }
    const matchSearchPayload = matchSearchEvent.data
      .payload as ReactScanMetaPayload;

    switch (payload.kind) {
      case "interaction-start": {
        if (matchSearchPayload.kind !== "interaction-end") {
          return false;
        }

        if (matchSearchPayload.interactionUUID !== payload.interactionUUID) {
          return false;
        }
        return true;
      }
      // a valid example an interaction end might go unmatched is:
      // very long task -> record force restart -> interaction end
      // now there is an interaction end not matched to a start
      case "interaction-end": {
        if (matchSearchPayload.kind !== "interaction-start") {
          return false;
        }

        if (matchSearchPayload.interactionUUID !== payload.interactionUUID) {
          return false;
        }
        return true;
      }
    }
  });

  return !hasMatch;
};

export const removeOldUnmatchedInteractionsFromMetadata = (
  events: Array<eventWithTime>
) => {
  return events.filter((event) => {
    // don't inline makes it easier to read
    if (
      Date.now() - event.timestamp > 3000 &&
      eventIsUnmatched(event, events)
    ) {
      if (event.type !== 6) {
        return true;
      }
      if (event.data.plugin !== "react-scan-meta") {
        return true;
      }
      const payload = event.data.payload as ReactScanMetaPayload;
      if (payload.kind === "fps-update") {
        return true;
      }
      console.log(
        `[Remove Old Unmatched] Removing ${payload.kind} for interaction ${payload.interactionUUID} - ` +
          `${Date.now() - event.timestamp}ms old and unmatched`
      );
      return false;
    }
    return true;
  });
};

export const removeInteractionsBeforeRecordingStart = () => {
  const recordingStart = rrwebEvents.at(0)?.timestamp;
  if (!recordingStart) {
    return;
  }
  interactionStore.setState(
    BoundedArray.fromArray(
      interactionStore
        .getCurrentState()
        .filter((interaction) => interaction.completedAt >= recordingStart),
      MAX_INTERACTION_BATCH
    )
  );
  if (lastInteractionTime && lastInteractionTime < recordingStart) {
    lastInteractionTime = null;
  }
};

export const removeUnusableMetadata = (events: Array<eventWithTime>) => {
  // me must make sure to unconditionally removed the associated end if the start is removed
  const removedInteractions: Array<string> = [];

  const recordStart = events.at(0)?.timestamp;

  if (recordStart === undefined) {
    return [];
  }

  events.forEach((event) => {
    if (event.type !== 6) {
      return;
    }

    if (event.data.plugin !== "react-scan-meta") {
      return;
    }
    const payload = event.data.payload as ReactScanMetaPayload;
    if (payload.kind === "fps-update") {
      return;
    }

    if (payload.kind !== "interaction-start") {
      return;
    }

    if (Date.now() - payload.dateNowTimestamp < 2000) {
      console.log(
        `[Removal] Interaction ${payload.interactionUUID} removed - Too recent (${Date.now() - payload.dateNowTimestamp}ms from now)`
      );
      // then its too close to the end of the interaction
      removedInteractions.push(payload.interactionUUID);
      return;
    }

    if (payload.dateNowTimestamp - recordStart <= 2000) {
      // then its too close to the start of the interaction
      removedInteractions.push(payload.interactionUUID);
      return;
    }
  });

  const eventsFilteredForTimeInvariants = events.filter((event) => {
    if (event.type !== 6) {
      return true;
    }

    if (event.data.plugin !== "react-scan-meta") {
      return true;
    }

    const payload = event.data.payload as ReactScanMetaPayload;

    if (payload.kind === "fps-update") {
      return true;
    }
    if (removedInteractions.includes(payload.interactionUUID)) {
      return false;
    }

    return true;
  });

  countMeta(eventsFilteredForTimeInvariants, "first filter");
  const alwaysMatchingMetadata = eventsFilteredForTimeInvariants.filter(
    (event) => {
      const matches = !eventIsUnmatched(event, eventsFilteredForTimeInvariants);
      if (
        !matches &&
        event.type === 6 &&
        event.data.plugin === "react-scan-meta" &&
        (event.data.payload as ReactScanMetaPayload).kind !== "fps-update"
      ) {
      }
      return matches;
    }
  );
  countMeta(alwaysMatchingMetadata, "second filter");

  return alwaysMatchingMetadata;
};

const countMeta = (events: Array<eventWithTime>, message?: string) => {
  const count = {
    start: 0,
    end: 0,
    raw: [] as any[],
  };
  events.forEach((e) => {
    ifScanMeta(e, (payload) => {
      if (payload.kind === "interaction-start") {
        count.start += 1;
        count.raw.push(payload);
        return;
      }
      if (payload.kind === "interaction-end") {
        count.end += 1;
        count.raw.push(payload);
        return;
      }
    });
  });
};

let currentTimeOut: ReturnType<typeof setTimeout>;
export const setDebouncedInterval = (
  callback: () => void,
  shouldDebounce: () => DebounceTime | false,
  baseTime = 4000
) => {
  const debounce = shouldDebounce();

  if (debounce === false) {
    callback();
    currentTimeOut = setTimeout(() => {
      setDebouncedInterval(callback, shouldDebounce, baseTime);
    }, baseTime);
    return () => {
      clearTimeout(currentTimeOut);
    };
  }
  currentTimeOut = setTimeout(() => {
    setDebouncedInterval(callback, shouldDebounce, debounce);
  }, debounce);

  return () => {
    clearTimeout(currentTimeOut);
  };
};

export const queueFlush = async () => {
  try {
    let fpsUpdateCount = 0;
    for (const event of rrwebEvents) {
      if (event.type === 6 && event.data.plugin === "react-scan-meta") {
        const payload = event.data.payload as ReactScanMetaPayload;
        if (payload.kind === "fps-update") {
          fpsUpdateCount++;
        }
      }
    }

    countMeta(rrwebEvents, "queue flush start");
    const completedInteractions = interactionStore.getCurrentState();
    if (!completedInteractions.length) {
      return;
    }

    if (!rrwebEvents.length) {
      return;
    }

    const payload: SerializableFlushPayload = {
      events: rrwebEvents,
      interactions: completedInteractions.map(
        convertInteractionFiberRenderParents
      ),
      fpsDiffs: [...fpsDiffs],
      // should verify lastRecordTime is always correct
      startAt: rrwebEvents[0].timestamp,
      completedAt: Date.now(),
    };
    logVideoAndInteractionMetadata(payload.interactions, payload.events);

    try {
      flushInvariant(payload);
    } catch (e) {
      console.error(e);
    }
    const body = JSON.stringify(payload);
    const completedUUIDS = payload.interactions.map(
      (interaction) => interaction.detailedTiming.interactionUUID
    );
    fpsDiffs.length = 0;
    logFPSUpdates(rrwebEvents);
    recordingTasks.push({
      flush: () => {
        console.debug("[Recording] Sending payload to server");
        fetch("http://localhost:4200/api/replay", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body,
        }).catch(() => null);

        interactionStore.setState(
          BoundedArray.fromArray(
            interactionStore
              .getCurrentState()
              .filter(
                (interaction) =>
                  !completedUUIDS.includes(
                    interaction.detailedTiming.interactionUUID
                  )
              ),
            MAX_INTERACTION_BATCH
          )
        );
      },
      interactionUUIDs: payload.interactions.map(
        (interaction) => interaction.detailedTiming.interactionUUID
      ),
    });
    // we continue recording as there's benefit to continue recording for as long as possible
    // but we no longer need to keep the interaction metadata related to pending flushed interactions
    rrwebEvents = rrwebEvents.filter((event) => {
      if (event.type !== 6 || event.data.plugin !== "react-scan-meta") {
        return true;
      }
      const payload = event.data.payload as ReactScanMetaPayload;
      if (payload.kind === "fps-update") {
        return true;
      }

      return !completedUUIDS.includes(payload.interactionUUID);
    });

    flushUploadedRecordingTasks(recordingTasks);
    interactionStore.setState(new BoundedArray(MAX_INTERACTION_BATCH));
  } catch (e) {
    console.error("[Recording] Error during flush:", e);
  }
};
