/** A searchable unit (one rendered row: transcript event, chat message). */
export interface FindSegment {
  /** Stable key the source can reveal and locate (e.g. event uuid). */
  key: string;
  /** Lowered rendered text (via findText's canonical walker/case fold). */
  lowerText: string;
}

/** A searchable surface registered with the FindController.
 *
 *  Implementations own corpus derivation and navigation for one view; the
 *  controller owns term/counts/cursor and painting. All methods must be safe
 *  to call at any time after registration.
 */
export interface FindSource {
  /** Segments in document order, or null while the corpus is still indexing.
   *  The controller publishes TOTALS atomically (only once this is non-null),
   *  but navigates early from getPrefixSegments() while indexing. */
  getSegments(): readonly FindSegment[] | null;
  /** Document-order prefix of segments extracted so far, while getSegments()
   *  is still null. Must only ever grow for unchanged data — ordinals the
   *  controller derives from it are shown as final while counting. Absent
   *  means no progressive results (the controller waits for completion). */
  getPrefixSegments?(): readonly FindSegment[];
  /** Subscribe to corpus changes (indexing completion, live data growth). */
  subscribe(listener: () => void): () => void;
  /** Make `key`'s element mountable (switch lane, expand tree ancestors,
   *  scroll the virtualizer) and call `onSettled` once the navigation scroll
   *  has come to rest. Must not wait for the element to exist — the
   *  controller observes the DOM for that. */
  reveal(key: string, onSettled: () => void): void;
  /** The scroll container that hosts segment elements (mount observer +
   *  centering target). */
  getContainer(): HTMLElement | null;
  /** The mounted element rendering segment `key`, scoped to the live
   *  container (never an offscreen indexing probe), else null. */
  getElement(key: string): HTMLElement | null;
  /** Revert navigation side effects this source performed for find (e.g.
   *  tree-node expansions). Called when the band closes. */
  cleanup(): void;
}
