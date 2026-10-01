import { isValidElement, ReactElement } from "react";

import { isRecord } from "@tsmono/util";

/**
 * Whether `v` is the `{ _html: <ReactElement> }` escape hatch callers build
 * to render bespoke JSX inside an otherwise data-driven grid. Only a real
 * element qualifies; a log-authored `_html` key holding data is not one.
 */
export const isHtmlEscape = (v: unknown): v is { _html: ReactElement } =>
  isRecord(v) && isValidElement(v._html);
