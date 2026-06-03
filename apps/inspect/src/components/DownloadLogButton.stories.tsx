import type { Decorator, Meta, StoryObj } from "@storybook/react";

import type { ClientAPI } from "../client/api/types";
import { ApiProvider } from "../state/store";

import { DownloadLogButton } from "./DownloadLogButton";

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
  download_log: async () => {},
};

const withApiProvider: Decorator = (Story) => (
  <ApiProvider value={stubApi}>
    <Story />
  </ApiProvider>
);

const meta = {
  component: DownloadLogButton,
  decorators: [withApiProvider],
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DownloadLogButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    log_file: "/logs/eval-2024-01-15.eval",
  },
};
