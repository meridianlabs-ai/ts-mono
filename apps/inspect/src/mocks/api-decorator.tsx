import type { Decorator } from "@storybook/react";

import type { ClientAPI } from "../client/api/types";
import { ApiProvider } from "../state/store";

const stubApi: ClientAPI = {
  get_app_config: async () => ({
    inspect_version: "0.0.0-storybook",
    scout_version: null,
  }),
  get_log_dir: async () => undefined,
  get_log_dir_handle: () => "",
  get_logs: async () => ({ log_dir: "", files: [] }) as never,
  get_log_root: async () => ({ logs: [] }),
  get_eval_set: async () => undefined,
  get_flow: async () => undefined,
  get_log_summaries: async () => [],
  get_log_details: async () => ({ eval: {}, sampleSummaries: [] }) as never,
  get_log_sample: async () => undefined,
  client_events: async () => [],
  download_file: async () => {},
  open_log_file: async () => {},
};

/** Wraps a story in an <ApiProvider/> backed by a no-op stub API. */
export const withApiProvider = (
  overrides: Partial<ClientAPI> = {}
): Decorator => {
  const api: ClientAPI = { ...stubApi, ...overrides };
  return (Story) => (
    <ApiProvider value={api}>
      <Story />
    </ApiProvider>
  );
};
