import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * The shared view's clock, kept outside React: the frame loop advances it
 * every frame, the few elements that follow it continuously (the readout,
 * the playhead, folded rows' snippets) subscribe to it, and the view itself
 * re-renders only when the clock crosses a publishWindow boundary.
 */
export type TerminalClock = StoreApi<{ playback: number }>;

export const createTerminalClock = (initial: number): TerminalClock =>
  createStore(() => ({ playback: initial }));

/**
 * What `select` derives from the clock, re-rendering the caller only when
 * that changes (compared with Object.is, so `select` returns a primitive).
 */
export const useTerminalClock = <T>(
  clock: TerminalClock,
  select: (playback: number) => T
): T => useStore(clock, (state) => select(state.playback));
