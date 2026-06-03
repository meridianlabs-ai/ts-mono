import type { Meta, StoryObj } from "@storybook/react";
import { action } from "storybook/actions";

import { FindBandUI } from "./FindBandUI";

const meta: Meta<typeof FindBandUI> = {
  component: FindBandUI,
  title: "Inspect/FindBandUI",
  tags: ["autodocs"],
  args: {
    onClose: action("onClose"),
    onNext: action("onNext"),
    onPrevious: action("onPrevious"),
    onKeyDown: action("onKeyDown"),
    onChange: action("onChange"),
    onBeforeInput: action("onBeforeInput"),
    inputRef: { current: null },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithMatches: Story = {
  args: {
    matchCount: 5,
    matchIndex: 2,
  },
};

export const NoResults: Story = {
  args: {
    noResults: true,
  },
};
