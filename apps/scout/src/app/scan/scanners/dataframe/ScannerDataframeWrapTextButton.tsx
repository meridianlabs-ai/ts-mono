import { FC, useCallback } from "react";

import { ToolButton } from "@tsmono/react/components";

import { ApplicationIcons } from "../../../../icons";
import { useStore } from "../../../../state/store";

export const ScannerDataframeWrapTextButton: FC = () => {
  const wrapText = useStore((state) => state.dataframeWrapText);
  const setWrapText = useStore((state) => state.setDataframeWrapText);

  const toggleWrapText = useCallback(() => {
    setWrapText(!wrapText);
  }, [wrapText, setWrapText]);

  return (
    <ToolButton
      icon={ApplicationIcons.wrap}
      label="Wrap Text"
      onClick={toggleWrapText}
      latched={wrapText}
      subtle={true}
    />
  );
};
