/**
 * Registry of collapse/clip boundaries that find-in-page can expand.
 *
 * Components that visually clip rendered text (ExpandablePanel's maxHeight
 * wrapper, EventPanel's hidden collapsed body) register their clipping element
 * here on mount. When the current match sits inside such an element, find
 * expands exactly that boundary — never panels that merely contain the term —
 * and reverts its expansions on step-away/close.
 *
 * Module-level map (not a context): registration is a mount side effect keyed
 * by the DOM element the painter walks past, and lookups happen outside React.
 */

export interface FindExpandHandle {
  /** Whether the boundary currently clips its content. */
  isClipped(): boolean;
  /** Reveal the clipped content (an overlay on top of the user's collapse
   *  state — must not persist anything). */
  expand(): void;
  /** Undo a previous expand(). */
  collapse(): void;
}

const registry = new Map<Element, FindExpandHandle>();

export const registerFindExpandable = (
  element: Element,
  handle: FindExpandHandle
): (() => void) => {
  registry.set(element, handle);
  return () => {
    registry.delete(element);
  };
};

export const getFindExpandHandle = (
  element: Element
): FindExpandHandle | undefined => registry.get(element);

export interface FindTabSwitchHandle {
  /** Whether the panel currently renders a tab other than its default. */
  isDiverted(): boolean;
  /** Render the default (corpus) tab — an overlay on the user's selection,
   *  which stays stored and returns on restore(). Must not persist anything. */
  switchToDefault(): void;
  /** Undo a previous switchToDefault(). */
  restore(): void;
}

const tabSwitchRegistry = new Map<Element, FindTabSwitchHandle>();

/** Sibling of registerFindExpandable for tabbed panels: consulted when the
 *  current match can't be painted because the panel's selected tab doesn't
 *  render the corpus text. */
export const registerFindTabSwitch = (
  element: Element,
  handle: FindTabSwitchHandle
): (() => void) => {
  tabSwitchRegistry.set(element, handle);
  return () => {
    tabSwitchRegistry.delete(element);
  };
};

/** Tab-switch boundaries under `root`. Paint failure means there is no range
 *  to walk ancestors of, so containment in the row element replaces the
 *  expand registry's ancestor walk. */
export const findTabSwitchesWithin = (
  root: Element
): [Element, FindTabSwitchHandle][] => {
  const out: [Element, FindTabSwitchHandle][] = [];
  for (const [element, handle] of tabSwitchRegistry) {
    if (root.contains(element)) out.push([element, handle]);
  }
  return out;
};
