import { createContext, useContext } from "react";

/** What a row rendered by a VirtualList may ask of its scroller. */
export interface VirtualScroller {
  /** The scroller's client-space box. */
  viewportRect(): DOMRect;
  /** Bring the row containing `node` to the viewport top by index: the
   *  virtualizer owns the target and re-aims it as rows measure. `onDone`
   *  runs once it reports the scroll finished (or the user took over). False
   *  when `node` is not inside one of this list's rows. */
  scrollToRow(node: Element, onDone?: () => void): boolean;
  /** Centre `box`, a client-space rect of content inside the row containing
   *  `node`, in the viewport: the row's position in the list plus the box's
   *  offset inside the row. For a row that has landed at the viewport top
   *  and is taller than it. The row's current size is recorded first, so a
   *  row that grew in this task (a panel opened for the occurrence) is
   *  scrolled within, not past. False when `node` is not inside one of this
   *  list's rows. */
  centreInRow(node: Element, box: DOMRect, onDone?: () => void): boolean;
  /** Called with a row element after the list has measured it (post-commit);
   *  returns the unsubscribe. */
  onRowMeasured(listener: (node: Element) => void): () => void;
}

export const VirtualScrollerContext = createContext<VirtualScroller | null>(
  null
);

/** The enclosing VirtualList's scroller, or null outside one. */
export const useVirtualScroller = (): VirtualScroller | null =>
  useContext(VirtualScrollerContext);
