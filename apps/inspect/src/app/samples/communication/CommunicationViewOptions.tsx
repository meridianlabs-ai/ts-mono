import { FC, useState } from "react";

import { ToolButton } from "@tsmono/react/components";

import { ViewOptionsPopover } from "../list/SamplesViewOptionsPopover";

interface CommunicationViewOptionsProps {
  multiline: boolean;
  setMultiline: (multiline: boolean) => void;
}

/** The Communication tab's View button: the samples list's view options. */
export const CommunicationViewOptions: FC<CommunicationViewOptionsProps> = ({
  multiline,
  setMultiline,
}) => {
  const [showing, setShowing] = useState(false);
  const [buttonEl, setButtonEl] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <ToolButton
        ref={setButtonEl}
        label="View"
        icon="options"
        onClick={(e) => {
          e.stopPropagation();
          setShowing((prev) => !prev);
        }}
        subtle
      />
      <ViewOptionsPopover
        id="communication-view-options-popover"
        showing={showing}
        setShowing={setShowing}
        positionEl={buttonEl}
        options={[
          {
            label: "Multiline",
            checked: multiline,
            onChange: () => setMultiline(!multiline),
          },
        ]}
      />
    </>
  );
};
