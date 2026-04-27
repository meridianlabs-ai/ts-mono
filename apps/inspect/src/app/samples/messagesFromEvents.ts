import type {
  ChatMessage,
  Event,
  ModelEvent,
} from "@tsmono/inspect-common/types";

const isSuccessfulModelEvent = (e: Event): e is ModelEvent =>
  e.event === "model" && !e.error;

export const messagesFromEvents = (runningEvents: Event[]): ChatMessage[] => {
  const modelEvents = runningEvents.filter(isSuccessfulModelEvent);

  // Build the conversation list by merging each model event's `input`
  // (the model's view at that call) in order. Per event: reset a cursor
  // to the end of the list, then walk its input. Known ids re-anchor
  // the cursor to their position without re-inserting; new ids splice
  // at cursor + 1. The output appends at the end of the list (not at
  // cursor + 1) and dedupes by id.
  //
  // The end-of-list cursor default lets an event whose input begins
  // with unseen messages (e.g. a compaction summary introduced ahead
  // of any prior anchor) extend the prefix rather than prepend. The
  // output-at-end rule then keeps the post-compaction assistant after
  // the summary, not between it and earlier history.
  const result: ChatMessage[] = [];
  const positions = new Map<string, number>();

  const insert = (index: number, m: ChatMessage) => {
    result.splice(index, 0, m);
    for (const [id, pos] of positions) {
      if (pos >= index) positions.set(id, pos + 1);
    }
    if (m.id) positions.set(m.id, index);
  };

  for (const e of modelEvents) {
    let cursor = result.length - 1;
    const seenInEvent = new Set<string>();
    for (const m of e.input) {
      if (!m.id || seenInEvent.has(m.id)) continue;
      seenInEvent.add(m.id);
      const known = positions.get(m.id);
      if (known !== undefined) {
        cursor = known;
      } else {
        cursor += 1;
        insert(cursor, m);
      }
    }
    const out = e.output.choices[0]?.message;
    if (out?.id && !positions.has(out.id)) {
      positions.set(out.id, result.length);
      result.push(out);
    }
  }

  return result;
};
