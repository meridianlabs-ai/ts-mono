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
  className?: string;
  scrollRef?: RefObject<HTMLElement | null>;
  data: T[];
  renderRow: (index: number, item: T) => ReactNode;
  live?: boolean;
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
  onVisibleRangeChange?: (range: {
    startIndex: number;
    endIndex: number;
  }) => void;
}
