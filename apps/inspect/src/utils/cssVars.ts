import type { CSSProperties } from "react";

/**
 * CSS custom properties for a `style` prop. csstype's `Properties` declares no
 * `--*` index signature, so a custom-property literal can't be written inline;
 * React passes these straight through to the DOM.
 */
export const cssVars = (
  vars: Record<`--${string}`, string | number>
): CSSProperties => vars;
