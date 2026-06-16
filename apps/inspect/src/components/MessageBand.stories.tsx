import type { Meta, StoryObj } from "@storybook/react";

import { withApiProvider } from "../mocks/api-decorator";

import { MessageBand } from "./MessageBand";

const meta = {
  component: MessageBand,
  decorators: [withApiProvider()],
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
