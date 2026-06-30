import type {
  ContentAudio,
  ContentImage,
  ContentText,
  ContentVideo,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import type { ToolAnnotation } from "../chat/tools/AnnotatedToolOutput";
import {
  BROWSER_TOOL_FUNCTIONS,
  buildSelfAnnotation,
  isBrowserScreenshot,
  isVisualBrowserAction,
} from "../chat/tools/browserActionUtils";

import type { EventNode } from "./types";

export interface VisualActionContext {
  inputScreenshot?: (
    | ContentText
    | ContentImage
    | ContentAudio
    | ContentVideo
  )[];
  selfAnnotation?: ToolAnnotation;
}

export function computeVisualActionContext(
  eventNodes: EventNode[],
  index: number
): VisualActionContext {
  const node = eventNodes[index];
  if (!node || node.event.event !== "tool") return {};

  const toolEvent = node.event;
  if (!isVisualBrowserAction(toolEvent.function, toolEvent.arguments))
    return {};

  const selfAnnotation = buildSelfAnnotation(
    toolEvent.function,
    toolEvent.arguments
  );

  for (let i = index - 1; i >= 0; i--) {
    const candidate = eventNodes[i];
    if (!candidate || candidate.event.event !== "tool") continue;
    const candEvent = candidate.event;
    if (!BROWSER_TOOL_FUNCTIONS.has(candEvent.function)) break;
    if (isBrowserScreenshot(candEvent.function, candEvent.arguments)) {
      const inputScreenshot = normalizeScreenshotResult(candEvent.result);
      return inputScreenshot ? { inputScreenshot, selfAnnotation } : {};
    }
  }

  return {};
}

export function normalizeScreenshotResult(
  result: ToolEvent["result"]
): (ContentText | ContentImage | ContentAudio | ContentVideo)[] | undefined {
  if (Array.isArray(result)) {
    const filtered = result.filter(
      (
        item
      ): item is ContentText | ContentImage | ContentAudio | ContentVideo =>
        item.type !== "document"
    );
    return filtered.length > 0 ? filtered : undefined;
  }
  if (result && typeof result === "object" && "type" in result) {
    if (result.type === "document") return undefined;
    return [result];
  }
  return undefined;
}
