import { StoreApi, UseBoundStore } from "zustand";

import {
  AttachmentData,
  ChatMessage,
  JsonValue,
  ModelEvent,
} from "@tsmono/inspect-common/types";
import { createLogger } from "@tsmono/util";

import { sampleIdsEqual } from "../app/shared/sample";
import { Event } from "../app/types";
import {
  ClientAPI,
  EventData,
  SampleData,
  SampleDataResponse,
  SampleSummary,
} from "../client/api/types";
import { resolveAttachments } from "../utils/attachments";
import { createPolling } from "../utils/polling";

import { resolveSample } from "./sampleUtils";
import { StoreState } from "./store";

const log = createLogger("samplePolling");

const kNoId = -1;
const kPollingInterval = 2;
const kPollingMaxRetries = 10;

// Keeps the state for polling (the last ids for events
// and attachments, the attachments and events, and
// a mapping from eventIds to event indexes to enable
// replacing events)
interface PollingState {
  eventId: number;
  attachmentId: number;
  messagePoolId: number;
  callPoolId: number;

  attachments: Record<string, string>;
  messagePool: ChatMessage[];
  callPool: JsonValue[];

  eventMapping: Record<string, number>;
  events: Event[];
}

export function createSamplePolling(
  store: UseBoundStore<StoreApi<StoreState>>
) {
  // The polling function that will be returned
  let currentPolling: ReturnType<typeof createPolling> | null = null;

  // handle aborts
  let abortController: AbortController | undefined;

  // The inintial polling state
  const pollingState: PollingState = {
    eventId: kNoId,
    attachmentId: kNoId,
    messagePoolId: kNoId,
    callPoolId: kNoId,

    eventMapping: {},
    attachments: {},
    messagePool: [],
    callPool: [],
    events: [],
  };

  // Function to start polling for a specific log file
  const startPolling = (logFile: string, summary: SampleSummary) => {
    // Create a unique identifier for this polling session
    const pollingId = `${logFile}:${summary.id}-${summary.epoch}`;
    log.debug(`Start Polling ${pollingId}`);

    // If we're already polling this resource, don't restart
    if (currentPolling && currentPolling.name === pollingId) {
      log.debug(`Aleady polling, ignoring start`);
      return;
    }

    // Stop any existing or completing session first. A previous session may
    // have already stopped its timer while still awaiting a terminal sample
    // fetch, so we also key off the abort controller here.
    if (
      currentPolling ||
      (abortController && !abortController.signal.aborted)
    ) {
      log.debug(`Resetting existing polling session`);
      stopPolling();

      // Clear any current running events
      store.getState().sampleActions.setRunningEvents([]);
    }

    // Always reset the polling state when starting new polling
    resetPollingState(pollingState);
    // Capture the controller in a local so this callback always checks
    // its own session's signal — even if `abortController` is later
    // reassigned by a subsequent startPolling call.
    const localAbort = new AbortController();
    abortController = localAbort;

    // Create the polling callback
    log.debug(`Polling sample: ${summary.id}-${summary.epoch}`);
    const pollCallback = async () => {
      const state = store.getState();
      const { sampleActions } = state;

      // Get the api
      const api = state.api;
      if (!api) {
        throw new Error("Required API is missing");
      }

      if (!api.get_log_sample_data) {
        throw new Error("Required API get_log_sample_data is undefined.");
      }

      if (localAbort.signal.aborted) {
        return false;
      }

      const loadCompletedSample = async (message: string) => {
        // A 404 from the server means that this sample has been flushed to the
        // main eval file. We also take the same path when the log summary says
        // the sample is complete but the buffer only returns empty deltas.
        stopPollingTimer();

        try {
          log.debug(message);
          const sample = await api.get_log_sample(
            logFile,
            summary.id,
            summary.epoch
          );

          // If the user navigated away while we were fetching, don't overwrite
          // the new sample's state with this stale result.
          if (localAbort.signal.aborted) {
            return false;
          }

          if (sample) {
            const migratedSample = resolveSample(sample);

            sampleActions.setSelectedSample(migratedSample, logFile);
            sampleActions.setSampleStatus("ok");
            sampleActions.setRunningEvents([]);
          } else {
            sampleActions.setSampleStatus("error");
            sampleActions.setSampleError(
              new Error("Unable to load sample - an unknown error occurred")
            );
            sampleActions.setRunningEvents([]);
          }
        } catch (e) {
          if (localAbort.signal.aborted) {
            return false;
          }
          sampleActions.setSampleError(e as Error);
          sampleActions.setSampleStatus("error");
          sampleActions.setRunningEvents([]);
        }

        return false;
      };

      // Fetch sample data
      const eventId = pollingState.eventId;
      const attachmentId = pollingState.attachmentId;
      const messagePoolId = pollingState.messagePoolId;
      const callPoolId = pollingState.callPoolId;
      const sampleDataResponse = await api.get_log_sample_data(
        logFile,
        summary.id,
        summary.epoch,
        eventId,
        attachmentId,
        messagePoolId !== kNoId ? messagePoolId : undefined,
        callPoolId !== kNoId ? callPoolId : undefined
      );

      if (localAbort.signal.aborted) {
        return false;
      }

      if (sampleDataResponse?.status === "NotFound") {
        return await loadCompletedSample(
          `LOADING COMPLETED SAMPLE AFTER FLUSH: ${summary.id}-${summary.epoch}`
        );
      }

      if (
        shouldFinalizeStreamingSample(
          sampleDataResponse,
          hasCompletedLogSummary(store.getState(), summary.id, summary.epoch)
        )
      ) {
        return await loadCompletedSample(
          `LOADING COMPLETED SAMPLE AFTER SUMMARY UPDATE: ${summary.id}-${summary.epoch}`
        );
      }

      if (
        sampleDataResponse?.status === "OK" &&
        sampleDataResponse.sampleData
      ) {
        if (localAbort.signal.aborted) {
          return false;
        }
        sampleActions.setSampleStatus("streaming");

        if (sampleDataResponse.sampleData) {
          // Process attachments
          processAttachments(sampleDataResponse.sampleData, pollingState);

          // Process pool entries (must come before events so refs can be resolved)
          processMessagePool(sampleDataResponse.sampleData, pollingState);
          processCallPool(sampleDataResponse.sampleData, pollingState);

          // Process events
          const processedEvents = processEvents(
            sampleDataResponse.sampleData,
            pollingState,
            api,
            logFile
          );

          // update max attachment id
          if (sampleDataResponse.sampleData.attachments.length > 0) {
            const maxAttachment = findMaxId(
              sampleDataResponse.sampleData.attachments,
              pollingState.attachmentId
            );
            log.debug(`New max attachment ${maxAttachment}`);
            pollingState.attachmentId = maxAttachment;
          }

          // update max event id
          if (sampleDataResponse.sampleData.events.length > 0) {
            const maxEvent = findMaxId(
              sampleDataResponse.sampleData.events,
              pollingState.eventId
            );
            log.debug(`New max event ${maxEvent}`);
            pollingState.eventId = maxEvent;
          }

          // Update the running events (ensure identity of runningEvents fails equality)
          if (processedEvents) {
            sampleActions.setRunningEvents([...pollingState.events]);
          }
        }
      }

      // Continue polling
      return true;
    };

    // Create the polling instance
    const polling = createPolling(pollingId, pollCallback, {
      maxRetries: kPollingMaxRetries,
      interval: kPollingInterval,
    });

    // Store the polling instance and start it
    currentPolling = polling;
    polling.start();
  };

  // Stop polling
  const stopPolling = () => {
    // Abort the in-flight callback (if any) so it bails out at its
    // next abort check instead of mutating state for a sample the
    // user has navigated away from.
    if (abortController) {
      abortController.abort();
    }
    stopPollingTimer();
  };

  const stopPollingTimer = () => {
    if (currentPolling) {
      currentPolling.stop();
      currentPolling = null;
    }
  };

  const cleanup = () => {
    log.debug(`Cleanup`);
    if (abortController) {
      abortController.abort();
    }
    stopPolling();
  };

  return {
    startPolling,
    stopPolling,
    cleanup,
  };
}

const hasCompletedLogSummary = (
  state: StoreState,
  sampleId: string | number,
  sampleEpoch: number
) => {
  return state.log.selectedLogDetails?.sampleSummaries.some(
    (sampleSummary) =>
      sampleIdsEqual(sampleSummary.id, sampleId) &&
      sampleSummary.epoch === sampleEpoch &&
      sampleSummary.completed !== false
  );
};

export const hasSampleDataUpdates = (sampleData?: SampleData) => {
  if (!sampleData) {
    return false;
  }

  return (
    sampleData.events.length > 0 ||
    sampleData.attachments.length > 0 ||
    sampleData.message_pool.length > 0 ||
    sampleData.call_pool.length > 0
  );
};

export const shouldFinalizeStreamingSample = (
  sampleDataResponse: SampleDataResponse | undefined,
  completedInLog: boolean | undefined
) => {
  if (!completedInLog || !sampleDataResponse) {
    return false;
  }

  return (
    sampleDataResponse.status === "NotModified" ||
    (sampleDataResponse.status === "OK" &&
      !hasSampleDataUpdates(sampleDataResponse.sampleData))
  );
};

const resetPollingState = (state: PollingState) => {
  state.eventId = kNoId;
  state.attachmentId = kNoId;
  state.messagePoolId = kNoId;
  state.callPoolId = kNoId;
  state.eventMapping = {};
  state.attachments = {};
  state.messagePool = [];
  state.callPool = [];
  state.events = [];
};

function processAttachments(
  sampleData: SampleData,
  pollingState: PollingState
) {
  log.debug(`Processing ${sampleData.attachments.length} attachments`);
  Object.values(sampleData.attachments).forEach((v) => {
    pollingState.attachments[v.hash] = v.content;
  });
}

function processMessagePool(
  sampleData: SampleData,
  pollingState: PollingState
) {
  if (!sampleData.message_pool.length) return;
  for (const entry of sampleData.message_pool) {
    pollingState.messagePool.push(JSON.parse(entry.data) as ChatMessage);
    pollingState.messagePoolId = Math.max(pollingState.messagePoolId, entry.id);
  }
}

function processCallPool(sampleData: SampleData, pollingState: PollingState) {
  if (!sampleData.call_pool.length) return;
  for (const entry of sampleData.call_pool) {
    pollingState.callPool.push(JSON.parse(entry.data) as JsonValue);
    pollingState.callPoolId = Math.max(pollingState.callPoolId, entry.id);
  }
}

function processEvents(
  sampleData: SampleData,
  pollingState: PollingState,
  api: ClientAPI,
  log_file: string
) {
  // Go through each event and resolve it, either appending or replacing
  log.debug(`Processing ${sampleData.events.length} events`);
  if (sampleData.events.length === 0) {
    return false;
  }

  for (const eventData of sampleData.events) {
    // Identify if this event id already has an event in the event list
    const existingIndex = pollingState.eventMapping[eventData.event_id];

    // Resolve attachments within this event
    const withAttachments = resolveAttachments<Event>(
      eventData.event,
      pollingState.attachments,
      (attachmentId: string) => {
        const snapshot = {
          eventId: eventData.event_id,
          attachmentId,
          available_attachments: Object.keys(pollingState.attachments),
        };

        if (api.log_message) {
          api.log_message(
            log_file,
            `Unable to resolve attachment ${attachmentId}\n` +
              JSON.stringify(snapshot)
          );
        }
        console.warn(`Unable to resolve attachment ${attachmentId}`, snapshot);
      }
    );

    // Resolve pool refs for model events
    const withPoolRefs = resolvePoolRefs(withAttachments, pollingState);

    // Resolve attachments again after pool expansion, since pool entries
    // may contain attachment:// URIs that weren't visible before expansion.
    const resolvedEvent = resolveAttachments<Event>(
      withPoolRefs,
      pollingState.attachments
    );

    if (existingIndex !== undefined) {
      // There is an existing event in the stream, replace it
      log.debug(`Replace event ${existingIndex}`);
      pollingState.events[existingIndex] = resolvedEvent;
    } else {
      // This is a new event, add to the event list and note
      // its position
      log.debug(`New event ${pollingState.events.length}`);

      const currentIndex = pollingState.events.length;
      pollingState.eventMapping[eventData.event_id] = currentIndex;
      pollingState.events.push(resolvedEvent);
    }
  }
  return true;
}

function expandRefs<T>(refs: [number, number][], pool: T[]): T[] {
  return refs.flatMap(([start, end]) => pool.slice(start, end));
}

function resolvePoolRefs(event: Event, pollingState: PollingState): Event {
  if (event.event !== "model") return event;

  const withInput =
    Array.isArray(event.input_refs) && pollingState.messagePool.length > 0
      ? {
          ...event,
          input: expandRefs(
            event.input_refs,
            pollingState.messagePool
          ) satisfies ModelEvent["input"],
          input_refs: null,
        }
      : event;

  if (!withInput.call || !Array.isArray(withInput.call.call_refs)) {
    return withInput;
  }

  const msgKey = (withInput.call.call_key as string) || "messages";
  const request = { ...withInput.call.request };
  request[msgKey] = expandRefs(withInput.call.call_refs, pollingState.callPool);
  return {
    ...withInput,
    call: {
      ...withInput.call,
      request,
      call_refs: null,
      call_key: null,
    },
  };
}

const findMaxId = (
  items: EventData[] | AttachmentData[],
  currentMax: number
) => {
  if (items.length > 0) {
    const newMax = Math.max(...items.map((i) => i.id), currentMax);
    return newMax;
  }
  return currentMax;
};
