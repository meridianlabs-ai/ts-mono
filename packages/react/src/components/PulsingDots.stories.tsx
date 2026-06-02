import type { Meta, StoryObj } from "@storybook/react";

import { PulsingDots } from "./PulsingDots";

const meta: Meta<typeof PulsingDots> = {
  component: PulsingDots,
  title: "Indicators/PulsingDots",
  decorators: [
    (Story) => (
      <div style={{ padding: "40px", display: "flex", justifyContent: "center" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof PulsingDots>;

export const Default: Story = {};

export const MediumSize: Story = {
  args: { size: "medium" },
};

export const LargeSize: Story = {
  args: { size: "large" },
};

export const WithVisibleText: Story = {
  args: { text: "Fetching data...", size: "medium", showText: true },
};

export const PrimaryStyle: Story = {
  args: { subtle: false, size: "medium" },
};

export const FiveDots: Story = {
  args: { dotsCount: 5, size: "medium" },
};
