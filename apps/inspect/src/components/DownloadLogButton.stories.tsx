import type { Meta, StoryObj } from "@storybook/react";

import { withApiProvider } from "../mocks/api-decorator";

import { DownloadLogButton } from "./DownloadLogButton";

const meta = {
  component: DownloadLogButton,
  decorators: [withApiProvider({ download_log: async () => {} })],
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
