import type { Meta, StoryObj } from "@storybook/react";
import { FC, useState } from "react";
import { action } from "storybook/actions";

import { Modal } from "./Modal";

interface DemoProps {
  title?: string;
  padded?: boolean;
}

const ModalDemo: FC<DemoProps> = ({ title, padded }) => {
  const [showing, setShowing] = useState(true);
  return (
    <Modal
      id="demo-modal"
      showing={showing}
      setShowing={(v) => {
        setShowing(v);
        action("setShowing")(v);
      }}
      title={title}
      padded={padded}
    >
      <p>Modal body content goes here.</p>
    </Modal>
  );
};

const ModalWithFooterDemo: FC<DemoProps> = ({ title, padded }) => {
  const [showing, setShowing] = useState(true);
  return (
    <Modal
      id="demo-modal-footer"
      showing={showing}
      setShowing={(v) => {
        setShowing(v);
        action("setShowing")(v);
      }}
      title={title}
      padded={padded}
      footer={
        <>
          <button className="btn btn-primary">Save</button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowing(false)}
          >
            Cancel
          </button>
        </>
      }
    >
      <p>Modal with a custom footer.</p>
    </Modal>
  );
};

const meta = {
  title: "Inspect/Modal",
  component: ModalDemo,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ModalDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Visible: Story = {
  args: {
    title: "Example Modal",
  },
};

export const WithFooter: Story = {
  render: (args) => <ModalWithFooterDemo {...args} />,
  args: {
    title: "Confirm Action",
  },
};
