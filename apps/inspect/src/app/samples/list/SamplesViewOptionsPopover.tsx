import clsx from "clsx";
import { FC } from "react";

import { PopOver } from "@tsmono/react/components";

import styles from "./SamplesViewOptionsPopover.module.css";
import {
  useSamplesView,
  useSamplesViewScoreColorScales,
} from "./useSamplesView";

interface ViewOption {
  label: string;
  checked: boolean;
  onChange: () => void;
}

interface ViewOptionsPopoverProps {
  id: string;
  showing: boolean;
  setShowing: (showing: boolean) => void;
  positionEl: HTMLElement | null;
  options: ViewOption[];
}

/** A view's presentation toggles, one checkbox each, under its View button. */
export const ViewOptionsPopover: FC<ViewOptionsPopoverProps> = ({
  id,
  showing,
  setShowing,
  positionEl,
  options,
}) => (
  <PopOver
    id={id}
    isOpen={showing}
    setIsOpen={setShowing}
    positionEl={positionEl}
    placement="bottom-end"
    showArrow={false}
    hoverDelay={-1}
    closeOnMouseLeave={false}
    offset={[0, 1]}
  >
    <div className={clsx(styles.container, "text-size-small")}>
      {options.map((option) => (
        <label key={option.label} className={styles.row}>
          <input
            type="checkbox"
            checked={option.checked}
            onChange={option.onChange}
            className={styles.checkbox}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  </PopOver>
);

interface SamplesViewOptionsPopoverProps {
  showing: boolean;
  setShowing: (showing: boolean) => void;
  positionEl: HTMLElement | null;
}

export const SamplesViewOptionsPopover: FC<SamplesViewOptionsPopoverProps> = ({
  showing,
  setShowing,
  positionEl,
}) => {
  const { view, setMultiline, setCompactScores, setColorScalesEnabled } =
    useSamplesView();
  const scoreColorScales = useSamplesViewScoreColorScales();
  const showColorScales = Object.keys(scoreColorScales).length > 0;

  return (
    <ViewOptionsPopover
      id="samples-view-options-popover"
      showing={showing}
      setShowing={setShowing}
      positionEl={positionEl}
      options={[
        {
          label: "Multiline",
          checked: view.multiline,
          onChange: () => setMultiline(!view.multiline),
        },
        {
          label: "Compact scores",
          checked: view.compactScores,
          onChange: () => setCompactScores(!view.compactScores),
        },
        ...(showColorScales
          ? [
              {
                label: "Score colors",
                checked: view.colorScalesEnabled,
                onChange: () => setColorScalesEnabled(!view.colorScalesEnabled),
              },
            ]
          : []),
      ]}
    />
  );
};
