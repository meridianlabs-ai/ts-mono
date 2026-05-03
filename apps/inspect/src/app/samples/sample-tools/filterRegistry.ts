import { kScoreTypeNumeric } from "../../../constants";
import { perScorerFieldKey } from "../../shared/samples-grid/columns";
import { EvalDescriptor } from "../descriptor/types";

import { bannedShortScoreNames } from "./filters";

export type FilterVarKind = "string" | "number";

export interface FilterVarMapping {
  /** Filtrex variable name. */
  variable: string;
  kind: FilterVarKind;
  /** If present, prefer this filtrex function for `contains`-style ag-grid
   *  predicates — matches the case-insensitive semantics of the existing
   *  `_contains` helpers. */
  containsFn?: string;
}

export interface SampleFilterRegistry {
  /** Lookup by ag-grid `colId` → filtrex variable. */
  byColId: Map<string, FilterVarMapping>;
  /** Lookup by filtrex variable name → ag-grid `colId`. */
  byVariable: Map<string, string>;
}

const STATIC_ENTRIES: Array<[string, FilterVarMapping]> = [
  ["sampleId", { variable: "id", kind: "string" }],
  ["sampleUuid", { variable: "uuid", kind: "string" }],
  ["epoch", { variable: "epoch", kind: "number" }],
  [
    "input",
    { variable: "input", kind: "string", containsFn: "input_contains" },
  ],
  [
    "target",
    { variable: "target", kind: "string", containsFn: "target_contains" },
  ],
  [
    "answer",
    { variable: "answer", kind: "string", containsFn: "answer_contains" },
  ],
  ["tokens", { variable: "tokens", kind: "number" }],
  ["duration", { variable: "duration", kind: "number" }],
  [
    "error",
    { variable: "error", kind: "string", containsFn: "error_contains" },
  ],
  ["limit", { variable: "limit", kind: "string" }],
  ["retries", { variable: "retries", kind: "number" }],
];

/** Build the column↔filtrex-variable registry. Score columns are added
 *  dynamically from `evalDescriptor.scores` so the variable name matches
 *  the same short/qualified rule used by `scoreVariables` in filters.ts. */
export const buildSampleFilterRegistry = (
  evalDescriptor: EvalDescriptor | undefined
): SampleFilterRegistry => {
  const entries: Array<[string, FilterVarMapping]> = [...STATIC_ENTRIES];

  if (evalDescriptor) {
    const banned = bannedShortScoreNames(evalDescriptor.scores);
    for (const { name, scorer } of evalDescriptor.scores) {
      const colId = perScorerFieldKey({ name, scorer });
      const variable =
        name === scorer || !banned.has(name) ? name : `${scorer}.${name}`;
      // Match the column's filter type: numeric scores use the number
      // filter and round-trip as numbers; everything else (boolean,
      // passfail, categorical, etc.) uses the text filter.
      const scoreType = evalDescriptor.scoreDescriptor({
        name,
        scorer,
      })?.scoreType;
      const kind: FilterVarKind =
        scoreType === kScoreTypeNumeric ? "number" : "string";
      entries.push([colId, { variable, kind }]);
    }
  }

  const byColId = new Map(entries);
  const byVariable = new Map(entries.map(([colId, m]) => [m.variable, colId]));
  return { byColId, byVariable };
};
