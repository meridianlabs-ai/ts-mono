/**
 * Clears the current text selection in the document.
 */
export const clearDocumentSelection = () => {
  const sel = window.getSelection();
  if (sel) {
    // Legacy WebKit Selection objects expose empty() but not removeAllRanges().
    const s = sel as Partial<Pick<Selection, "removeAllRanges" | "empty">>;
    if (s.removeAllRanges) {
      s.removeAllRanges();
    } else if (s.empty) {
      s.empty();
    }
  }
};

/**
 * True if the element accepts text input (input/textarea/select/contentEditable).
 * Use to skip global keyboard handlers when focus is in a form field.
 */
export function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}
