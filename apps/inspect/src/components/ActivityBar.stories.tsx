import type { Meta, StoryObj } from "@storybook/react";

import { ActivityBar } from "./ActivityBar";

const meta = {
  title: "Inspect/ActivityBar",
  component: ActivityBar,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ActivityBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    animating: false,
  },
};

export const Animating: Story = {
  args: {
    animating: true,
  },
};

export const WithProgress: Story = {
  args: {
    animating: true,
    progress: 0.65,
  },
};
