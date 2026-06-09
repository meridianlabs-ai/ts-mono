import type { Meta, StoryObj } from "@storybook/react";

import { PulsingEllipsis } from "./PulsingEllipsis";

const meta: Meta<typeof PulsingEllipsis> = {
  component: PulsingEllipsis,
  title: "Indicators/PulsingEllipsis",
  decorators: [
    (Story) => (
      <div style={{ padding: "40px", display: "flex", justifyContent: "center" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    text: "Loading",
  },
};

export default meta;
type Story = StoryObj<typeof PulsingEllipsis>;

export const Default: Story = {};

export const Generating: Story = {
  args: { text: "Generating" },
};
