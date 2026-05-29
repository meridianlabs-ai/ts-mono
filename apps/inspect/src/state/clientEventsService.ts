import { createLogger } from "@tsmono/util";

import { ClientAPI } from "../client/api/types";
import { createPolling } from "../utils/polling";

const log = createLogger("Client-Events-Service");

const kRetries = 10;
const kPollingInterval = 5;
const kRefreshEvent = "refresh-evals";

class ClientEventsService {
  private currentPolling: ReturnType<typeof createPolling> | null = null;
  private abortController: AbortController | null = null;
  private isRefreshing = false;
  private onRefreshCallback:
    | ((reason: "event" | "periodic") => Promise<void>)
    | null = null;

  setRefreshCallback(
    callback: (reason: "event" | "periodic") => Promise<void>
  ) {
    this.onRefreshCallback = callback;
  }

  private async refreshLogFiles(reason: "event" | "periodic") {
    if (this.isRefreshing || !this.onRefreshCallback) {
      return;
    }

    this.isRefreshing = true;
    try {
      await this.onRefreshCallback(reason);
    } finally {
      this.isRefreshing = false;
    }
  }

  startPolling(api: ClientAPI) {
    this.stopPolling();

    this.abortController = new AbortController();

    let pollingCount = 1;
    this.currentPolling = createPolling(
      `Client-Events`,
      async () => {
        if (this.abortController?.signal.aborted) {
          log.debug(`Component unmounted, stopping poll for client events`);
          return false;
        }

        log.debug(`Polling client events`);
        const events = await api.client_events();
        log.debug(`Received events`, events);

        if (this.abortController?.signal.aborted) {
          log.debug(`Polling aborted, stopping poll for client events`);
          return false;
        }

        if ((events || []).includes(kRefreshEvent)) {
          await this.refreshLogFiles("event");
        }

        if (pollingCount++ % 10 === 0) {
          await this.refreshLogFiles("periodic");
        }

        return true;
      },
      {
        maxRetries: kRetries,
        interval: kPollingInterval,
      }
    );

    this.currentPolling.start();
  }

  stopPolling() {
    if (this.currentPolling) {
      this.currentPolling.stop();
      this.currentPolling = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  cleanup() {
    log.debug(`Cleanup`);
    this.stopPolling();
    this.onRefreshCallback = null;
  }
}

// Singleton instance
export const clientEventsService = new ClientEventsService();
