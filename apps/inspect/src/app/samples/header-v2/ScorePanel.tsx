import clsx from "clsx";
import { FC, useEffect, useMemo, useState } from "react";

import { ScoreValue } from "../../../@types/extraInspect";
import { ScoreLabel } from "../../../app/types";
import { BasicSampleData } from "../../../client/api/types";
import { EvalDescriptor } from "../descriptor/types";

import styles from "./ScorePanel.module.css";
import { scoreTone, Tone } from "./scoreTone";
import { ScoreChipValueDisplay, ScoreValueDisplay } from "./ScoreValueDisplay";
import { SortDir, SortIcon } from "./SortIcon";
import { ScoreView, ViewToggle } from "./ViewToggle";

interface ScorePanelProps {
  scores: ScoreLabel[];
  sample: BasicSampleData;
  evalDescriptor: EvalDescriptor;
}

interface RenderedScore {
  label: ScoreLabel;
  key: string;
  value: ScoreValue | undefined;
  scoreType: string;
  tone: Tone;
}

type SortColumn = "name" | "value" | null;

interface SortState {
  column: SortColumn;
  dir: "asc" | "desc";
}

const TONE_RANK: Record<Tone, number> = {
  fail: 0,
  warn: 1,
  neutral: 2,
  pass: 3,
};

/**
 * Score panel for the V2 sample header — the right column when there
 * are 3+ scores. Defaults to chips for ≤ 6 scores, grid for 7+; the
 * user can toggle between modes via the icon-only segmented control
 * in the panel header. In grid mode, click "Score" or "Value" to
 * cycle the sort direction (asc → desc → unsorted).
 */
export const ScorePanel: FC<ScorePanelProps> = ({
  scores,
  sample,
  evalDescriptor,
}) => {
  const renderedScores = useMemo<RenderedScore[]>(() => {
    return scores.map((label) => {
      const selected = evalDescriptor.score(sample, label);
      const descriptor = evalDescriptor.scoreDescriptor(label);
      return {
        label,
        key: `${label.scorer}__${label.name}`,
        value: selected?.value,
        scoreType: descriptor.scoreType,
        tone: scoreTone(selected?.value, descriptor.scoreType),
      };
    });
  }, [scores, sample, evalDescriptor]);

  const count = renderedScores.length;
  const tight = count <= 6;
  const dense = count > 12;
  const defaultView: ScoreView = count <= 6 ? "chips" : "grid";
  const [view, setView] = useState<ScoreView>(defaultView);
  // Reset to the default if the count crosses the threshold (e.g. when
  // selectedScores changes). Without this, e.g. switching from a 5-score
  // sample to a 20-score sample would leave us in chips mode where grid
  // would be the better default.
  useEffect(() => {
    setView(defaultView);
  }, [defaultView]);

  const [sort, setSort] = useState<SortState>({ column: null, dir: "asc" });
  const sortedScores = useMemo(() => {
    if (!sort.column) return renderedScores;
    const cmp = makeCompare(sort.column);
    const out = [...renderedScores].sort(cmp);
    if (sort.dir === "desc") out.reverse();
    return out;
  }, [renderedScores, sort.column, sort.dir]);

  const onSort = (col: "name" | "value") => {
    setSort((cur) => {
      if (cur.column !== col) return { column: col, dir: "asc" };
      if (cur.dir === "asc") return { column: col, dir: "desc" };
      return { column: null, dir: "asc" };
    });
  };
  const dirFor = (col: "name" | "value"): SortDir =>
    sort.column === col ? sort.dir : "none";

  return (
    <div className={clsx(styles.panel, tight && styles.tight)}>
      <div className={styles.panelHeader}>
        {view === "grid" ? (
          <>
            <button
              type="button"
              className={clsx(styles.columnLabel, styles.sortable)}
              onClick={() => onSort("name")}
            >
              <span>Score</span>
              <SortIcon dir={dirFor("name")} />
            </button>
            <button
              type="button"
              className={clsx(styles.columnLabel, styles.sortable)}
              onClick={() => onSort("value")}
            >
              <span>Value</span>
              <SortIcon dir={dirFor("value")} />
            </button>
          </>
        ) : (
          <div className={styles.scoresHeader}>
            <span className={styles.columnLabel}>Scores</span>
            <span className={styles.scoresCount}>{count}</span>
          </div>
        )}
        <ViewToggle view={view} setView={setView} />
      </div>
      <div
        className={clsx(
          styles.panelBody,
          view === "grid" ? styles.bodyGrid : styles.bodyChips,
          dense && (view === "grid" ? styles.denseGrid : styles.denseChips)
        )}
      >
        {view === "grid"
          ? sortedScores.map((s) => (
              <ScoreRow key={s.key} score={s} tight={tight} />
            ))
          : sortedScores.map((s) => <ScoreChip key={s.key} score={s} />)}
      </div>
    </div>
  );
};

interface ScoreRowProps {
  score: RenderedScore;
  tight: boolean;
}

const ScoreRow: FC<ScoreRowProps> = ({ score, tight }) => {
  return (
    <div
      className={clsx(
        styles.row,
        tight && styles.rowTight,
        score.tone === "fail" && styles.rowFail,
        score.tone === "warn" && styles.rowWarn
      )}
      title={score.label.name}
    >
      <span className={styles.rowName}>{score.label.name}</span>
      <ScoreValueDisplay
        value={score.value}
        scoreType={score.scoreType}
        size={18}
      />
    </div>
  );
};

interface ScoreChipProps {
  score: RenderedScore;
}

const ScoreChip: FC<ScoreChipProps> = ({ score }) => {
  const attention = score.tone === "fail" || score.tone === "warn";
  return (
    <span
      className={clsx(
        styles.chip,
        attention && styles.chipAttention,
        score.tone === "fail" && styles.chipFail,
        score.tone === "warn" && styles.chipWarn
      )}
      title={score.label.name}
    >
      <ScoreChipValueDisplay
        value={score.value}
        scoreType={score.scoreType}
        size={16}
      />
      <span className={styles.chipName}>{score.label.name}</span>
    </span>
  );
};

function makeCompare(
  column: "name" | "value"
): (a: RenderedScore, b: RenderedScore) => number {
  if (column === "name") {
    return (a, b) =>
      a.label.name.localeCompare(b.label.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
  }
  return (a, b) => {
    const av = a.value;
    const bv = b.value;
    const an = typeof av === "number" ? av : null;
    const bn = typeof bv === "number" ? bv : null;
    if (an !== null && bn !== null) return an - bn;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    const as = av === undefined ? "" : String(av);
    const bs = bv === undefined ? "" : String(bv);
    return as.localeCompare(bs, undefined, { numeric: true });
  };
}

// Re-export for callers that may want it later (e.g. an alternate
// "sort by tone status" entry point).
export { TONE_RANK };
