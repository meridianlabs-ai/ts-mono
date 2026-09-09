/**
 * The windowed SampleMessagesData source: folded rows served from
 * conversation windows, with a lazy row index scanned only as far as
 * reads require. Three coordinate systems, one per layer: consumers
 * speak display rows (the merged system row plus conversation rows),
 * the index maps display rows to message positions, and the
 * conversation seam maps positions to storage. The scan reads raw
 * (attachments unresolved) and keeps only row facts, so indexing costs
 * message-chunk fetches for the range actually read — never attachment
 * downloads, never resident messages.
 */
import {
  buildMessageRowsWindow,
  buildSystemMessageRow,
  MessageRowScanner,
  messagesToStr,
  type MessageRow,
  type MessageRowOptions,
} from "@tsmono/inspect-components/chat";

import { log } from "./chunked/log";
import { type SampleConversation } from "./conversation";
import {
  kDefaultMessageRowOptions,
  type MessageRowsPage,
  type SampleMessagesData,
} from "./messageRows";

/** Messages fed to the scanner per index step (raw reads — cheap). */
const kScanBatchMessages = 512;

/** Messages per exportText part (resolved reads — bounded residency). */
const kExportBatchMessages = 200;

class LazyRowIndex {
  readonly scanner: MessageRowScanner;
  scanPos = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly conversation: SampleConversation,
    options: MessageRowOptions
  ) {
    this.scanner = new MessageRowScanner(options);
  }

  get exhausted(): boolean {
    return this.scanPos >= this.conversation.messageCount;
  }

  /** The merged-system-row shift: display row 0 renders one block. */
  get shift(): number {
    return this.scanner.hasSystemRow ? 1 : 0;
  }

  /** Display rows known-complete so far (exact total once exhausted). */
  get knownRowCount(): number {
    return this.shift + this.scanner.completedRowCount(this.exhausted);
  }

  /** Whole-conversation number of scanner row `i`'s first block. */
  startNumber(i: number): number {
    return 1 + this.shift + (this.scanner.rows[i]?.blocksBefore ?? 0);
  }

  /**
   * Scan until `target` display rows are complete or the conversation is
   * exhausted. Steps are serialized: concurrent reads extend one scan
   * instead of racing it, and a failed step leaves `scanPos` unadvanced
   * so the next read retries the same batch.
   */
  ensureRows(target: number): Promise<void> {
    const step = async (): Promise<void> => {
      while (!this.exhausted && this.knownRowCount < target) {
        const end = Math.min(
          this.scanPos + kScanBatchMessages,
          this.conversation.messageCount
        );
        const batch = await this.conversation.getMessagesRaw(this.scanPos, end);
        batch.forEach((message, i) => {
          this.scanner.next(message, this.scanPos + i);
        });
        this.scanPos = end;
      }
    };
    this.chain = this.chain.then(step, step);
    return this.chain;
  }
}

/**
 * A source over any `SampleConversation` — the windowed counterpart of
 * `inMemoryMessageRows`. Pages are served by mapping the display-row
 * window to a message window through the index, reading it resolved, and
 * re-folding with the scan's numbering: fold locality guarantees the
 * result equals the whole-conversation fold restricted to those rows.
 */
export const windowedMessageRows = (
  conversation: SampleConversation,
  options: MessageRowOptions = kDefaultMessageRowOptions
): SampleMessagesData => {
  const index = new LazyRowIndex(conversation, options);

  const systemRow = async (): Promise<MessageRow | undefined> => {
    const starts = [...index.scanner.systemStarts];
    const systemMessages = (
      await Promise.all(
        starts.map((pos) => conversation.getMessages(pos, pos + 1))
      )
    ).flat();
    return buildSystemMessageRow(systemMessages);
  };

  return {
    getRows: async (pagination): Promise<MessageRowsPage> => {
      const offset = pagination.cursor?.["offset"];
      let lo = Math.max(0, typeof offset === "number" ? offset : 0);
      let hi = lo + Math.max(pagination.limit, 0);

      await index.ensureRows(hi);
      const known = index.knownRowCount;
      const exhausted = index.exhausted;
      if (exhausted) {
        lo = Math.min(lo, known);
        hi = Math.min(hi, known);
      }

      const shift = index.shift;
      const rows: MessageRow[] = [];
      if (shift === 1 && lo === 0 && hi > 0) {
        const merged = await systemRow();
        // hasSystemRow implies mergeable content exists
        if (merged) {
          rows.push(merged);
        }
      }
      const sLo = Math.max(0, lo - shift);
      const sHi = Math.max(sLo, hi - shift);
      if (sHi > sLo) {
        const facts = index.scanner.rows;
        const msgLo = facts[sLo]?.start ?? 0;
        // past the last discovered head, the window is bounded by what
        // the scan has covered: to the conversation end once exhausted,
        // else to the scan frontier (everything there is sealed rows
        // plus system/tool tails the fold drops)
        const msgHi =
          sHi < facts.length
            ? (facts[sHi]?.start ?? index.scanPos)
            : exhausted
              ? conversation.messageCount
              : index.scanPos;
        const messages = await conversation.getMessages(msgLo, msgHi);
        const folded = buildMessageRowsWindow(
          messages,
          msgLo,
          index.startNumber(sLo),
          options
        );
        if (folded.length !== sHi - sLo) {
          log.error(
            `windowed fold mismatch: rows [${sLo}, ${sHi}) folded to ` +
              `${folded.length} rows from messages [${msgLo}, ${msgHi})`
          );
        }
        rows.push(...folded);
      }

      // cursors are minted only when the page made progress (hi > lo), so
      // a degenerate limit can never produce a self-referential cursor and
      // a drain-until-null loop always terminates
      return {
        rows,
        offset: lo,
        knownRowCount: known,
        exhausted,
        nextCursor:
          hi > lo && (hi < known || !exhausted) ? { offset: hi } : null,
      };
    },

    exportText: async function* (): AsyncIterable<string> {
      // export speaks message space directly — raw conversation order,
      // system messages in place — so it needs no row index at all.
      // messagesToStr joins per-message entries with "\n" and no default
      // option drops a message, so batch parts stitched with "\n"
      // reproduce the whole-conversation text exactly
      const count = conversation.messageCount;
      for (let pos = 0; pos < count; pos += kExportBatchMessages) {
        const batch = await conversation.getMessages(
          pos,
          Math.min(pos + kExportBatchMessages, count)
        );
        const part = messagesToStr(batch);
        yield pos === 0 ? part : `\n${part}`;
      }
    },
  };
};
