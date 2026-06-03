import { Decorator } from "@storybook/react";

import { ComponentIconProvider } from "@tsmono/react/components";
import { initializeStore } from "../../../apps/inspect/src/state/store";
import type { ClientAPI, Capabilities, ClientStorage } from "../../../apps/inspect/src/client/api/types";

const icons = {
  chevronDown: "bi-chevron-down",
  chevronUp: "bi-chevron-up",
  clearText: "bi-x",
  close: "bi-x-lg",
  code: "bi-code",
  confirm: "bi-check",
  copy: "bi-copy",
  error: "bi-exclamation-circle",
  menu: "bi-list",
  next: "bi-chevron-right",
  noSamples: "bi-file-earmark",
  play: "bi-play",
  previous: "bi-chevron-left",
  toggleRight: "bi-chevron-right",
};

export const withIcons: Decorator = (Story) => (
  <ComponentIconProvider icons={icons}>
    <Story />
  </ComponentIconProvider>
);

const stubApi: ClientAPI = {
  get_log_dir: async () => undefined,
  get_log_dir_handle: () => "",
  get_logs: async () => ({ files: [], response_type: "full" as const }),
  get_log_root: async () => ({ logs: [], log_dir: undefined, abs_log_dir: undefined }),
  get_eval_set: async () => undefined,
  get_flow: async () => undefined,
  get_log_summaries: async () => [],
  get_log_details: async () => {
    throw new Error("not implemented");
  },
  get_log_sample: async () => undefined,
  client_events: async () => [],
  download_file: async () => {},
  open_log_file: async () => {},
};

const stubCapabilities: Capabilities = {
  downloadFiles: false,
  downloadLogs: false,
  webWorkers: false,
  streamSamples: false,
  streamSampleData: false,
};

const stubStorage: ClientStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

let storeInitialized = false;

export const withStore: Decorator = (Story) => {
  if (!storeInitialized) {
    initializeStore(stubApi, stubCapabilities, stubStorage);
    storeInitialized = true;
  }
  return <Story />;
};
