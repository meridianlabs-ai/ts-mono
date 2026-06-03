import type { Decorator, Meta, StoryObj } from "@storybook/react";

import type { ClientAPI } from "../client/api/types";
import { ApiProvider } from "../state/store";

import { DownloadButton } from "./DownloadButton";

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

const withApiProvider: Decorator = (Story) => (
  <ApiProvider value={stubApi}>
    <Story />
  </ApiProvider>
);

const meta = {
  component: DownloadButton,
  decorators: [withApiProvider],
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
