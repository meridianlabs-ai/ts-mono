import { FC } from "react";

import type { JsonValue } from "@tsmono/inspect-common/types";
import { Modal } from "@tsmono/react/components";

import { ScoreValue } from "../components/ScoreValue";

interface AllScoresDialogProps {
  showing: boolean;
  setShowing: (showing: boolean) => void;
  score: JsonValue;
}

export const AllScoresDialog: FC<AllScoresDialogProps> = ({
  showing,
  setShowing,
  score,
}) => {
  return (
    <Modal show={showing} onHide={() => setShowing(false)} title="All Scores">
      <ScoreValue score={score} />
    </Modal>
  );
};
