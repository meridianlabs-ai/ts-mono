import type { Meta, StoryObj } from "@storybook/react";

import { withIcons } from "../../.storybook/decorators";

import { ErrorPanel } from "./ErrorPanel";

const meta: Meta<typeof ErrorPanel> = {
  component: ErrorPanel,
  title: "Feedback/ErrorPanel",
  decorators: [withIcons],
};

export default meta;
type Story = StoryObj<typeof ErrorPanel>;

export const BasicError: Story = {
  args: {
    title: "Server Error",
    error: { message: "Failed to fetch log files from the server." },
  },
};

export const WithStackTrace: Story = {
  args: {
    title: "Internal Error",
    error: {
      message: "TypeError: Cannot read properties of undefined (reading 'map')",
      stack: "Array.map (<anonymous>)\n    at processLogs (logsSlice.ts:142)\n    at syncLogs (logsSlice.ts:98)",
    },
  },
};

export const LongErrorMessage: Story = {
  args: {
    title: "Connection Error",
    error: {
      message:
        "The server at https://inspect-api.example.com/v1/logs returned HTTP 503 Service Unavailable. " +
        "This typically indicates the server is temporarily overloaded or under maintenance. " +
        "Please try again in a few minutes. If the problem persists, check the server status page.",
    },
  },
};
