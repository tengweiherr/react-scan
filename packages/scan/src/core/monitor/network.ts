import { Store } from "../..";
import { GZIP_MIN_LEN, GZIP_MAX_LEN, MAX_PENDING_REQUESTS } from "./constants";
import { getSession } from "./utils";
import type {
  Interaction,
  IngestRequest,
  InternalInteraction,
  Component,
  Session,
} from "./types";
import { performanceEntryChannels } from "src/core/monitor/performance-store";
import {
  interactionStore,
  MAX_INTERACTION_BATCH,
} from "src/core/monitor/interaction-store";
import { BoundedArray } from "src/core/monitor/performance-utils";
import { CompletedInteraction } from "./performance";

let afterFlushListeners: Array<() => void> = [];
export const addAfterFlushListener = (
  cb: () => void,
  opts?: { once?: boolean }
) => {
  afterFlushListeners.push(() => {
    cb();
    if (opts?.once) {
      afterFlushListeners = afterFlushListeners.filter(
        (listener) => listener !== cb
      );
    }
  });
};

export type InteractionWithArrayParents = {
  detailedTiming: Omit<
    CompletedInteraction["detailedTiming"],
    "fiberRenders"
  > & {
    fiberRenders: {
      [key: string]: {
        renderCount: number;
        parents: string[];
        selfTime: number;
      };
    };
  };
  latency: number;
  completedAt: number;
  flushNeeded: boolean;
};

export const convertInteractionFiberRenderParents = (
  interaction: CompletedInteraction
): InteractionWithArrayParents => ({
  ...interaction,
  detailedTiming: {
    ...interaction.detailedTiming,
    fiberRenders: Object.fromEntries(
      Object.entries(interaction.detailedTiming.fiberRenders).map(
        ([key, value]) => [
          key,
          {
            ...value,
            parents: Array.from(value.parents),
          },
        ]
      )
    ),
  },
});

const INTERACTION_TIME_TILL_COMPLETED = 4000;

// TODO: truncate floats for clickhouse
// const truncate = (value: number, decimalPlaces = 4) =>
//   Number(value.toFixed(decimalPlaces));
let pendingInteractionUUIDS: Array<string> = [];

export const flush = async (): Promise<void> => {
  const monitor = Store.monitor.value;
  if (
    !monitor ||
    // // !navigator.onLine ||
    !monitor.url ||
    // // !monitor.interactions.length
    !interactionStore.getCurrentState().length
  ) {
    return;
  }

  const session = await getSession({
    commit: "mock",
    branch: "mock",
  }).catch(() => null);

  if (!session) {
    return;
  }

  const completedInteractions = interactionStore
    .getCurrentState()
    .filter(
      (interaction) =>
        !pendingInteractionUUIDS.includes(
          interaction.detailedTiming.interactionUUID
        ) && interaction.flushNeeded
    );
  if (!completedInteractions.length) {
    return;
  }

  const payload: {
    interactions: InteractionWithArrayParents[];
    session: Session;
  } = {
    interactions: completedInteractions.map(
      convertInteractionFiberRenderParents
    ),
    session,
  };

  monitor.pendingRequests++;

  pendingInteractionUUIDS.push(
    ...completedInteractions.map((interaction) => {
      interaction.flushNeeded = false;
      return interaction.detailedTiming.interactionUUID;
    })
  );
  try {
    transport(monitor.url, payload)
      .then(() => {
        performanceEntryChannels.publish(
          payload.interactions.map(
            (interaction) => interaction.detailedTiming.interactionUUID
          ),
          "flushed-interactions"
        );
        monitor.pendingRequests--;
        afterFlushListeners.forEach((cb) => {
          cb();
        });
      })
      .catch(async (e) => {
        // we let the next interval handle retrying, instead of explicitly retrying
        // monitor.interactions = monitor.interactions.concat(
        //   completedInteractions,
        // );
        completedInteractions.forEach((interaction) => {
          interaction.flushNeeded = true;
        });
        interactionStore.setState(
          BoundedArray.fromArray(
            interactionStore.getCurrentState().concat(completedInteractions),
            MAX_INTERACTION_BATCH
          )
        );
      })
      .finally(() => {
        pendingInteractionUUIDS = pendingInteractionUUIDS.filter(
          (uuid) =>
            !completedInteractions.some(
              (interaction) =>
                interaction.detailedTiming.interactionUUID === uuid
            )
        );
      });
  } catch {
    /* */
  }

};

const CONTENT_TYPE = "application/json";
const supportsCompression = typeof CompressionStream === "function";

export const compress = async (payload: string): Promise<ArrayBuffer> => {
  const stream = new Blob([payload], { type: CONTENT_TYPE })
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
};

/**
 * Modified from @palette.dev/browser:
 *
 * @see https://gist.github.com/aidenybai/473689493f2d5d01bbc52e2da5950b45#file-palette-dev-browser-dist-palette-dev-mjs-L365
 */
export const transport = async (
  url: string,
  payload: IngestRequest
): Promise<{ ok: boolean }> => {
  const fail = { ok: false };
  const json = JSON.stringify(payload);
  // gzip may not be worth it for small payloads,
  // only use it if the payload is large enough
  const shouldCompress = false; //TODO CHANGE THIS BACK ITS JUST TO MAKE DEBUGGING EASIER
  const body =
    shouldCompress && supportsCompression ? await compress(json) : json;

  if (!navigator.onLine) return fail;
  const headers: any = {
    "Content-Type": CONTENT_TYPE,
    "Content-Encoding": shouldCompress ? "gzip" : undefined,
    "x-api-key": Store.monitor.value?.apiKey,
  };
  if (shouldCompress) url += "?z=1";
  const size = typeof body === "string" ? body.length : body.byteLength;

  return fetch(url, {
    body,
    method: "POST",
    referrerPolicy: "origin",
    /**
     * Outgoing requests are usually cancelled when navigating to a different page, causing a "TypeError: Failed to
     * fetch" error and sending a "network_error" client-outcome - in Chrome, the request status shows "(cancelled)".
     * The `keepalive` flag keeps outgoing requests alive, even when switching pages. We want this since we're
     * frequently sending events right before the user is switching pages (e.g., when finishing navigation transactions).
     *
     * This is the modern alternative to the navigator.sendBeacon API.
     * @see https://javascript.info/fetch-api#keepalive
     *
     * Gotchas:
     * - `keepalive` isn't supported by Firefox
     * - As per spec (https://fetch.spec.whatwg.org/#http-network-or-cache-fetch):
     *   If the sum of contentLength and inflightKeepaliveBytes is greater than 64 kibibytes, then return a network error.
     *   We will therefore only activate the flag when we're below that limit.
     * - There is also a limit of requests that can be open at the same time, so we also limit this to 15.
     *
     * @see https://github.com/getsentry/sentry-javascript/pull/7553
     */
    keepalive:
      GZIP_MAX_LEN > size &&
      MAX_PENDING_REQUESTS > (Store.monitor.value?.pendingRequests ?? 0),
    priority: "low",
    // mode: 'no-cors',
    headers,
    mode: "no-cors", // this fixes cors, but will need to actually fix correctly later
  });
};
