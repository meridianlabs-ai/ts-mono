import type {
  ComponentType,
  CSSProperties,
  ReactNode,
  Ref,
  RefObject,
} from "react";

export interface VirtualListStateSnapshot {
  version: 1;
  scrollOffset: number;
  totalCount: number;
}

export interface VirtualListHandle {
  scrollToIndex(opts: {
    index: number;
    align?: "start" | "center" | "end";
    behavior?: "auto" | "smooth";
    onDone?: () => void;
  }): void;
  scrollTo(opts: { top: number; behavior?: "auto" | "smooth" }): void;
  getState(callback: (snapshot: VirtualListStateSnapshot) => void): void;
  jumpToStart(): void;
  jumpToEnd(): void;
}

export interface VirtualListItemProps {
  "data-index": number;
  "data-item-index": number;
  "data-known-size": number;
  style: CSSProperties;
  children?: ReactNode;
}

export interface VirtualListComponents {
  Item?: ComponentType<VirtualListItemProps>;
  Footer?: ComponentType;
}

export interface VirtualListProps<T> {
  persistenceKey: string;
  ref?: Ref<VirtualListHandle>;
  /** DOM id applied to the list's root element. */
  id?: string;
  className?: string;
  /** External scroll container: the element itself when the host has already
   *  resolved it, or a ref for targets that mount late. Omit for a
   *  self-scrolling list. */
  scrollRef?: RefObject<HTMLElement | null> | HTMLElement | null;
  data: T[];
  renderRow: (index: number, item: T) => ReactNode;
  /** Estimated row height (px) used for rows not yet measured. */
  estimatedItemHeight?: number;
  /** Rows rendered beyond the visible range (items, not px). */
  overscan?: number;
  /** The list shares an external scroll container with content ABOVE it:
   *  measure the list's offset in the container and feed it to the
   *  virtualizer (TanStack scrollMargin) so windowing lines up with the
   *  container's scrollTop. Off by default — hosts that already compensate
   *  for chrome above the list (e.g. the transcript's scrollPaddingStart
   *  landings) must not have the correction applied twice. */
  embedded?: boolean;
  /** When false, a mount with no persisted snapshot leaves the scroll
   *  container's position alone instead of resetting it to top. Defaults to
   *  `!embedded`: an embedded list shares a container whose position the host
   *  owns (e.g. a stateful tab scroller), so resetting would yank it. */
  resetScrollOnMount?: boolean;
  live?: boolean;
  /** This mount is owned by navigation (a `?event=`/`?message=` deep link, or
   *  an exit-focus landing): the deep-link landing owns the scroll position, so
   *  follow STANDS DOWN at mount — it does not auto-arm from `live`, and it
   *  overrides a persisted `follow=true` carried in the store. Follow can still
   *  arm afterwards from an explicit act (scrolling to the tail, stepping past
   *  the last turn, or `followRequested`). Frozen by the host at mount. */
  navOwned?: boolean;
  /** An explicit `follow=1` URL param: arm live-tail at mount regardless of
   *  `navOwned`. Frozen by the host at mount. */
  followRequested?: boolean;
  showProgress?: boolean;
  initialIndex?: number;
  /** Offset (px) subtracted from scroll-to-index landings, e.g. to clear sticky
   * chrome. Forwarded to the virtualizer's scrollPaddingStart so it survives
   * tanstack's scroll reconcile. */
  scrollPaddingStart?: number;
  components?: VirtualListComponents;
  smoothScroll?: boolean;
  itemSearchText?: (item: T) => string | string[];
  findScope?: "local" | "none";
  scrollToTopOnFinish?: boolean;
  /** Called when the rendered range changes, AND replayed with the current
   *  range whenever the callback's identity changes — callers rely on that
   *  replay to re-check conditions that shift under a static viewport (e.g.
   *  near-end paging when appended rows land). Keep the callback in the
   *  notifying effect's deps. */
  onVisibleRangeChange?: (range: {
    startIndex: number;
    endIndex: number;
  }) => void;
}
