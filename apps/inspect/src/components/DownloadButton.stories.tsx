import type { Decorator, Meta, StoryObj } from "@storybook/react";

import type { Capabilities, ClientAPI } from "../client/api/types";
import { initializeStore } from "../state/store";

import { DownloadButton } from "./DownloadButton";

const stubCapabilities: Capabilities = {
  downloadFiles: false,
  downloadLogs: false,
  webWorkers: false,
  streamSamples: false,
  streamSampleData: false,
};

const stubApi: ClientAPI = {
  get_log_dir: async () => undefined,
  get_log_dir_handle: () => "",
  get_logs: async () => ({ log_dir: "", files: [] }) as never,
  get_log_root: async () => ({ logs: [] }) as never,
  get_eval_set: async () => undefined,
  get_flow: async () => undefined,
  get_log_summaries: async () => [],
  get_log_details: async () => ({ eval: {}, sampleSummaries: [] }) as never,
  get_log_sample: async () => undefined,
  client_events: async () => [],
  download_file: async () => {},
  open_log_file: async () => {},
};

let initialized = false;

const withInspectStore: Decorator = (Story) => {
  if (!initialized) {
    initializeStore(stubApi, stubCapabilities);
    initialized = true;
  }
  return <Story />;
};

const meta = {
  title: "Inspect/DownloadButton",
  component: DownloadButton,
  decorators: [withInspectStore],
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DownloadButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Download CSV",
    fileName: "data.csv",
    fileContents: '{"results": []}',
  },
};
