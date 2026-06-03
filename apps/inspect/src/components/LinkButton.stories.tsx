import type { Meta, StoryObj } from "@storybook/react";
import { action } from "storybook/actions";

import { LinkButton } from "./LinkButton";

const meta = {
  component: LinkButton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LinkButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithText: Story = {
  args: {
    text: "Download",
    onClick: action("onClick"),
  },
};

export const WithIcon: Story = {
  args: {
    icon: "bi bi-download",
    onClick: action("onClick"),
  },
};

export const WithTextAndIcon: Story = {
  args: {
    text: "Download",
    icon: "bi bi-download",
    onClick: action("onClick"),
  },
};
