import type { Meta, StoryObj } from "@storybook/react";

import { GridLoadingOverlay } from "./GridLoadingOverlay";

const meta: Meta<typeof GridLoadingOverlay> = {
  component: GridLoadingOverlay,
  title: "Indicators/GridLoadingOverlay",
  decorators: [
    (Story) => (
      <div
        style={{
          height: "300px",
          border: "1px solid #e0e0e0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafafa",
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof GridLoadingOverlay>;

export const Default: Story = {};
