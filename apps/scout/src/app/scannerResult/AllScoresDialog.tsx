import clsx from "clsx";
import { FC, useCallback, useMemo, useState } from "react";

import type { JsonValue } from "@tsmono/inspect-common/types";
import { Modal } from "@tsmono/react/components";
import { isRecord } from "@tsmono/util";

import { ApplicationIcons } from "../../icons";
import { valueAsString } from "../utils/format";

import styles from "./AllScoresDialog.module.css";

type SortColumn = "name" | "value";
type SortDirection = "asc" | "desc";

interface ScoreEntry {
  name: string;
  value: unknown;
}

const flattenScores = (score: JsonValue): ScoreEntry[] => {
  if (isRecord(score) && typeof score === "object") {
    return Object.entries(score).map(([name, value]) => ({ name, value }));
  }
  return [];
};

const compareValues = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return valueAsString(a ?? "").localeCompare(valueAsString(b ?? ""));
};

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
  const [sortColumn, setSortColumn] = useState<SortColumn>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = useCallback(
    (column: SortColumn) => {
      if (sortColumn === column) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortColumn(column);
        setSortDirection("asc");
      }
    },
    [sortColumn]
  );

  const entries = useMemo(() => flattenScores(score), [score]);

  const sortedEntries = useMemo(() => {
    const sorted = [...entries];
    sorted.sort((a, b) => {
      const cmp =
        sortColumn === "name"
          ? a.name.localeCompare(b.name)
          : compareValues(a.value, b.value);
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [entries, sortColumn, sortDirection]);

  const sortIcon = (column: SortColumn) => {
    if (sortColumn !== column) return null;
    return (
      <i
        className={clsx(
          sortDirection === "asc"
            ? ApplicationIcons.arrows.up
            : ApplicationIcons.arrows.down,
          styles.sortIcon
        )}
      />
    );
  };

  return (
    <Modal
      show={showing}
      onHide={() => setShowing(false)}
      title="All Scores"
      className={styles.dialog}
    >
      <div className={styles.body}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th onClick={() => handleSort("name")}>
                <span className={styles.headerContent}>
                  Score
                  {sortIcon("name")}
                </span>
              </th>
              <th
                className={styles.valueHeader}
                onClick={() => handleSort("value")}
              >
                <span className={styles.headerContent}>
                  Value
                  {sortIcon("value")}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => (
              <tr key={entry.name}>
                <td className={styles.nameCell}>{entry.name}</td>
                <td className={styles.valueCell}>{String(entry.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
};
