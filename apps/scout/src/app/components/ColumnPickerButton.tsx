import { clsx } from "clsx";
import { FC, ReactNode, useState } from "react";

import { ToolButton } from "@tsmono/react/components";

import styles from "./ColumnPickerButton.module.css";

export interface ColumnPickerRenderProps {
  positionEl: HTMLButtonElement | null;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export interface ColumnPickerButtonProps {
  /**
   * Render prop for the popover content.
   * Receives positionEl, isOpen, and setIsOpen to wire up the popover.
   */
  children: (props: ColumnPickerRenderProps) => ReactNode;
}

/**
 * Column picker button pattern extracted for reuse.
 * Manages button ref and open/closed state internally.
 * Uses render prop pattern to allow domain-specific popovers.
 */
export const ColumnPickerButton: FC<ColumnPickerButtonProps> = ({
  children,
}) => {
  const [buttonEl, setButtonEl] = useState<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <ToolButton
        ref={setButtonEl}
        icon="checkboxChecked"
        label="Choose columns"
        title="Choose columns"
        latched={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        subtle
        className={clsx("text-size-smallest", styles.columnsButton)}
      />
      {children({
        positionEl: buttonEl,
        isOpen,
        setIsOpen,
      })}
    </>
  );
};
