import type { Meta, StoryObj } from "@storybook/react";
import { FC, useRef } from "react";
import { action } from "storybook/actions";

import { LargeModal } from "./LargeModal";

interface DemoProps {
  title?: string;
  detail: string;
  showProgress: boolean;
  visible: boolean;
}

const LargeModalDemo: FC<DemoProps> = ({
  title,
  detail,
  showProgress,
  visible,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <LargeModal
      title={title}
      detail={detail}
      showProgress={showProgress}
      visible={visible}
      onHide={action("onHide")}
      onkeyup={() => undefined}
      scrollRef={scrollRef}
    >
      <p>This is the modal body content.</p>
      <p>Additional paragraph content inside the modal.</p>
    </LargeModal>
  );
};

const meta = {
  title: "Components/LargeModal",
  component: LargeModalDemo,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LargeModalDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Evaluation Result",
    detail: "task/sample-123",
    showProgress: false,
    visible: true,
  },
};

export const WithProgress: Story = {
  args: {
    title: "Running Evaluation",
    detail: "task/running-456",
    showProgress: true,
    visible: true,
  },
};
