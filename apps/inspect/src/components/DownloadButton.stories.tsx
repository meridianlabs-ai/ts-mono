import type { Meta, StoryObj } from "@storybook/react";

import { withApiProvider } from "../mocks/api-decorator";

import { DownloadButton } from "./DownloadButton";

const meta = {
  component: DownloadButton,
  decorators: [withApiProvider()],
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DownloadButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Download CSV",
    fileName: "data.csv",
    fileContents: '{"results": []}',
  },
};
