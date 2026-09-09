import { useCallback, useMemo } from "react";

import {
  eventTypeValues,
  kDefaultExcludeEvents,
  type EventTypeValue,
} from "@tsmono/inspect-components/transcript";

import { useStore } from "../../../state/store";

const isEventTypeValue = (value: string): value is EventTypeValue =>
  eventTypeValues.some((type) => type === value);

export const useTranscriptColumnFilter = () => {
  const excludedEventTypes =
    useStore((state) => state.transcriptState.excludedTypes) ||
    kDefaultExcludeEvents;

  const setTranscriptState = useStore((state) => state.setTranscriptState);

  const setExcludedEventTypes = useCallback(
    (newTypes: EventTypeValue[]) => {
      setTranscriptState((prev) => ({
        ...prev,
        excludedTypes: [...newTypes],
      }));
    },
    [setTranscriptState]
  );

  const toggleEventType = useCallback(
    (type: EventTypeValue, isCurrentlyExcluded: boolean) => {
      // The persisted list is plain strings: a name retired since it was
      // stored isn't an event type any more.
      const excluded: readonly string[] = excludedEventTypes;
      const newExcluded = new Set<EventTypeValue>(
        excluded.filter(isEventTypeValue)
      );
      if (isCurrentlyExcluded) {
        newExcluded.delete(type);
      } else {
        newExcluded.add(type);
      }

      setExcludedEventTypes(Array.from(newExcluded));
    },
    [excludedEventTypes, setExcludedEventTypes]
  );

  const setDebugFilter = useCallback(() => {
    setExcludedEventTypes([]);
  }, [setExcludedEventTypes]);

  const setDefaultFilter = useCallback(() => {
    setExcludedEventTypes([...kDefaultExcludeEvents]);
  }, [setExcludedEventTypes]);

  const isDefaultFilter = useMemo(() => {
    return (
      excludedEventTypes.length === kDefaultExcludeEvents.length &&
      excludedEventTypes.every((type) =>
        kDefaultExcludeEvents.some((t) => t === type)
      )
    );
  }, [excludedEventTypes]);

  const isDebugFilter = useMemo(() => {
    return excludedEventTypes.length === 0;
  }, [excludedEventTypes]);

  const arrangedEventTypes = useCallback((columns: number = 1) => {
    // Sort keys alphabetically with default disabled keys at the end
    const sortedKeys = [...eventTypeValues].sort((a, b) => {
      const aIsDefault = kDefaultExcludeEvents.includes(a);
      const bIsDefault = kDefaultExcludeEvents.includes(b);

      // If one is in default exclude set and the other isn't, default goes to end
      if (aIsDefault && !bIsDefault) return 1;
      if (!aIsDefault && bIsDefault) return -1;

      // Both are in same category (both default or both not default), sort alphabetically
      return a.localeCompare(b);
    });

    if (columns === 1) {
      return sortedKeys;
    }

    // Arrange for multi-column layout with proper reading order
    const itemsPerColumn = Math.ceil(sortedKeys.length / columns);
    const columnArrays: EventTypeValue[][] = [];

    // Split into columns
    for (let col = 0; col < columns; col++) {
      const start = col * itemsPerColumn;
      const end = Math.min(start + itemsPerColumn, sortedKeys.length);
      columnArrays.push(sortedKeys.slice(start, end));
    }

    // Interleave items from all columns
    const arrangedKeys: EventTypeValue[] = [];
    const maxItemsInColumn = Math.max(...columnArrays.map((col) => col.length));

    for (let row = 0; row < maxItemsInColumn; row++) {
      for (let col = 0; col < columns; col++) {
        const item = columnArrays[col]?.[row];
        if (item !== undefined) {
          arrangedKeys.push(item);
        }
      }
    }

    return arrangedKeys;
  }, []);

  return {
    excludedEventTypes,
    isDefaultFilter,
    isDebugFilter,
    setDefaultFilter,
    setDebugFilter,
    toggleEventType,
    arrangedEventTypes,
  };
};
