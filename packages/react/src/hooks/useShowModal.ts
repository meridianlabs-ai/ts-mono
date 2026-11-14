import { RefCallback, useCallback, useState } from "react";

/**
 * Opens a `<dialog>` as a modal (`showModal()`) once it mounts, and closes it
 * before it unmounts so the browser returns focus to whatever had it before.
 * Attach the returned ref to the dialog; `dialog` is the element once it is
 * open.
 *
 * Render the dialog's content only once `dialog` is set. A closed dialog is
 * `display: none`, so content mounted with it couldn't take focus
 * (`autoFocus`). The ref runs during the commit and React re-renders
 * synchronously before paint, so the content still appears in the first
 * painted frame.
 *
 * Once open, the element marked `data-autofocus` takes focus on the next
 * frame: web components (vscode-elements) render their inner input
 * asynchronously after they mount, so focusing them any earlier is a no-op.
 */
export function useShowModal(): {
  ref: RefCallback<HTMLDialogElement>;
  dialog: HTMLDialogElement | null;
} {
  const [open, setOpen] = useState<HTMLDialogElement | null>(null);
  // useCallback for identity, not speed: React re-runs a ref callback (closing
  // and reopening the dialog) whenever its identity changes.
  const ref = useCallback((dialog: HTMLDialogElement | null) => {
    if (!dialog) return;
    dialog.showModal();
    setOpen(dialog);
    const frame = requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (dialog.open) dialog.close();
    };
  }, []);
  return { ref, dialog: open };
}
