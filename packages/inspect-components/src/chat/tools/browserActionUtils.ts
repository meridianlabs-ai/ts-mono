import type { ToolAnnotation } from "./AnnotatedToolOutput";

export const BROWSER_TOOL_FUNCTIONS = new Set(["browser", "computer"]);

export const VISUAL_BROWSER_ACTIONS = new Set([
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "scroll",
  "type",
  "key",
]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asCoordinate(value: unknown): [number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]];
  }
  return undefined;
}

export function isVisualBrowserAction(
  functionName: string,
  args: Record<string, unknown>
): boolean {
  if (!BROWSER_TOOL_FUNCTIONS.has(functionName)) return false;
  const action = asString(args.action);
  return action !== undefined && VISUAL_BROWSER_ACTIONS.has(action);
}

export function isBrowserScreenshot(
  functionName: string,
  args: Record<string, unknown>
): boolean {
  return (
    BROWSER_TOOL_FUNCTIONS.has(functionName) &&
    asString(args.action) === "screenshot"
  );
}

export function buildSelfAnnotation(
  functionName: string,
  args: Record<string, unknown>
): ToolAnnotation | undefined {
  if (!isVisualBrowserAction(functionName, args)) return undefined;
  const action = asString(args.action);
  if (action === undefined) return undefined;
  return {
    action,
    coordinate: asCoordinate(args.coordinate),
    text: asString(args.text),
    scrollDirection: asString(args.scroll_direction),
  };
}
