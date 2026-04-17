import { useCallback } from "react";

import type { Event } from "@tsmono/inspect-common/types";
import type { MarkdownReference } from "@tsmono/react/components";

import {
  sampleEventUrl,
  useLogOrSampleRouteParams,
  useSampleUrlBuilder,
} from "../../routing/url";

const kScannerReferencesKey = "scanner_references";
const kScannerContentKey = "scanner_content";

export type ScannerRefType = "message" | "event";

export interface ScannerRefEntry {
  type: ScannerRefType;
  id: string;
  cite: string;
}

type Metadata = Record<string, unknown> | null | undefined;

export function isScannerScore(metadata: Metadata): boolean {
  return !!metadata && kScannerReferencesKey in metadata;
}

export function metadataWithoutScannerKeys(
  metadata: Metadata,
): Record<string, unknown> {
  if (!metadata) return {};
  const {
    [kScannerReferencesKey]: _refs,
    [kScannerContentKey]: _content,
    ...rest
  } = metadata;
  return rest;
}

export function readScannerReferences(metadata: Metadata): ScannerRefEntry[] {
  if (!metadata) return [];
  const raw = metadata[kScannerReferencesKey];
  if (!Array.isArray(raw)) return [];
  const entries: ScannerRefEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { type, id, cite } = item as Record<string, unknown>;
    if (
      (type === "message" || type === "event") &&
      typeof id === "string" &&
      typeof cite === "string" &&
      cite.length > 0
    ) {
      entries.push({ type, id, cite });
    }
  }
  return entries;
}

/**
 * Walk a list of events to find the event that contains a given message id.
 *
 * Scanner message references can point to messages that live inside a
 * ModelEvent's input/output (sub-agent conversations) rather than in the
 * sample's top-level `messages` list. The transcript renders events, not the
 * flat message list, so every reference — message or event — ultimately
 * navigates to an event uuid.
 *
 * Priorities (mirror of inspect-components' resolveMessageToEvent):
 *   1. ModelEvent.output[*].message.id
 *   2. ToolEvent.message_id
 *   3. ModelEvent.input[*].id
 */
export function findEventForMessage(
  messageId: string,
  events: readonly Event[] | null | undefined,
): string | undefined {
  if (!events) return undefined;
  let inputMatch: string | undefined;
  let toolMatch: string | undefined;

  for (const e of events) {
    if (e.event === "model") {
      if (!e.uuid) continue;
      for (const choice of e.output?.choices ?? []) {
        if (choice.message?.id === messageId) {
          return e.uuid; // highest-priority match — done
        }
      }
      if (!inputMatch) {
        for (const msg of e.input ?? []) {
          if (msg.id === messageId) {
            inputMatch = e.uuid;
            break;
          }
        }
      }
    } else if (e.event === "tool") {
      if (!toolMatch && e.uuid && e.message_id === messageId) {
        toolMatch = e.uuid;
      }
    }
  }

  return toolMatch ?? inputMatch;
}

export function buildScoreMarkdownRefs(
  metadata: Metadata,
  makeUrl: (id: string, type: ScannerRefType) => string | undefined,
): MarkdownReference[] {
  if (!isScannerScore(metadata)) return [];
  return readScannerReferences(metadata).map((ref) => ({
    id: ref.id,
    cite: ref.cite,
    citeUrl: makeUrl(ref.id, ref.type),
  }));
}

export type MakeCiteUrl = (
  id: string,
  type: ScannerRefType,
) => string | undefined;

/**
 * Hook that returns a cite URL builder closing over the sample's events and
 * identifiers. Call this wherever those values are already available and pass
 * the returned function to `buildScoreMarkdownRefs` (or `SampleScoresSidebar`)
 * so the score-rendering components don't have to know about navigation.
 */
export function useMakeCiteUrl(opts: {
  events?: readonly Event[] | null;
  sampleId?: string | number;
  sampleEpoch?: number;
}): MakeCiteUrl {
  const { events, sampleId, sampleEpoch } = opts;
  const builder = useSampleUrlBuilder();
  const {
    logPath: urlLogPath,
    id: urlSampleId,
    epoch: urlEpoch,
  } = useLogOrSampleRouteParams();

  return useCallback(
    (id, type) => {
      if (!urlLogPath) return undefined;
      const effectiveSampleId = sampleId ?? urlSampleId;
      const effectiveEpoch = sampleEpoch ?? urlEpoch;
      // Both reference types ultimately resolve to an event uuid — the
      // transcript renders events, not the flat message list, so "message"
      // refs are mapped to the event that contains the message.
      const eventId =
        type === "event" ? id : findEventForMessage(id, events);
      if (!eventId) return undefined;
      const path = sampleEventUrl(
        builder,
        eventId,
        urlLogPath,
        effectiveSampleId,
        effectiveEpoch,
      );
      // MarkdownDivWithReferences only intercepts clicks whose href starts
      // with "#/"; plain paths would trigger a full browser navigation.
      return path ? `#${path}` : undefined;
    },
    [
      events,
      sampleId,
      sampleEpoch,
      builder,
      urlLogPath,
      urlSampleId,
      urlEpoch,
    ],
  );
}
