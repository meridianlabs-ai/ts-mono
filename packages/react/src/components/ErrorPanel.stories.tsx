import type { Meta, StoryObj } from "@storybook/react";

import { ComponentIconProvider, ComponentIcons } from "./ComponentIconContext";
import { ErrorPanel } from "./ErrorPanel";

const mockIcons: ComponentIcons = {
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

const meta: Meta<typeof ErrorPanel> = {
  component: ErrorPanel,
  title: "Feedback/ErrorPanel",
  decorators: [
    (Story) => (
      <ComponentIconProvider icons={mockIcons}>
        <div style={{ padding: "40px", maxWidth: "600px" }}>
          <Story />
        </div>
      </ComponentIconProvider>
    ),
  ],
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
