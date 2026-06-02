import type { Meta, StoryObj } from "@storybook/react";

import { withIcons } from "../../.storybook/decorators";

import { NoContentsPanel } from "./NoContentsPanel";

const meta: Meta<typeof NoContentsPanel> = {
  component: NoContentsPanel,
  title: "Feedback/NoContentsPanel",
  decorators: [withIcons],
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
