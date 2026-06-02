import type { Meta, StoryObj } from "@storybook/react";

import { ComponentIconProvider, ComponentIcons } from "./ComponentIconContext";
import { NoContentsPanel } from "./NoContentsPanel";

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

const meta: Meta<typeof NoContentsPanel> = {
  component: NoContentsPanel,
  title: "Feedback/NoContentsPanel",
  decorators: [
    (Story) => (
      <ComponentIconProvider icons={mockIcons}>
        <div style={{ padding: "40px", height: "300px", border: "1px dashed #ccc" }}>
          <Story />
        </div>
      </ComponentIconProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NoContentsPanel>;

export const Default: Story = {
  args: {
    text: "No samples",
  },
};

export const CustomText: Story = {
  args: {
    text: "No tasks found in this directory",
  },
};
