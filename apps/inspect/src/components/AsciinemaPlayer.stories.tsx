// network-dependent: loads cast from asciinema.org
import type { Meta, StoryObj } from "@storybook/react";

import { AsciinemaPlayer } from "./AsciinemaPlayer";

const DEMO_CAST_URL = "https://asciinema.org/a/335480.cast";

const meta = {
  component: AsciinemaPlayer,
} satisfies Meta<typeof AsciinemaPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    inputUrl: DEMO_CAST_URL,
    outputUrl: DEMO_CAST_URL,
    timingUrl: DEMO_CAST_URL,
    rows: 24,
    cols: 80,
    autoPlay: false,
  },
};

export const AutoPlay: Story = {
  args: {
    inputUrl: DEMO_CAST_URL,
    outputUrl: DEMO_CAST_URL,
    timingUrl: DEMO_CAST_URL,
    rows: 24,
    cols: 80,
    autoPlay: true,
  },
};
