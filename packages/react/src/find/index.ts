export * from "./types";
export {
  FindProvider,
  useFindCoordinator,
  useFindCoordinatorOptional,
  useFindState,
  useFindSurface,
} from "./FindCoordinatorContext";
export { FindStore, FIND_SURVEY_LIMIT, FIND_STEP_LIMIT } from "./findStore";
export { useFindHighlights } from "./useFindHighlights";
export { FindAnchorContainer } from "./FindAnchorContainer";
export {
  flashElement,
  supportsCustomHighlights,
  FIND_MATCH_HIGHLIGHT,
  FIND_ACTIVE_HIGHLIGHT,
} from "./highlightRegistry";
// Internal to the default in-memory engine and the row highlighter — NOT
// part of the find contract; dies in phase 3 with the rendered-form
// projection (D11).
export {
  prepareFindTerm,
  findTermOccurrences,
  type PreparedFindTerm,
  type TermOccurrence,
} from "./termMatching";
