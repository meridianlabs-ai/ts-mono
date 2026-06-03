import type { Decorator, Meta, StoryObj } from "@storybook/react";

import type { ClientAPI } from "../client/api/types";
import { ApiProvider } from "../state/store";

import { MessageBand } from "./MessageBand";

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
  component: MessageBand,
  decorators: [withApiProvider],
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    id: "demo-message",
  },
} satisfies Meta<typeof MessageBand>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {
  args: {
    id: "info-message",
    type: "info",
    message: "This is an informational message.",
  },
};

export const Warning: Story = {
  args: {
    id: "warning-message",
    type: "warning",
    message: "Something looks suspicious.",
  },
};

export const Error: Story = {
  args: {
    id: "error-message",
    type: "error",
    message: "An error occurred.",
  },
};
