/**
 * Clears the current text selection in the document.
 */
export const clearDocumentSelection = () => {
  const sel = window.getSelection();
  if (sel) {
    if (sel.removeAllRanges) {
      sel.removeAllRanges();
    } else if (sel.empty) {
      sel.empty();
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
