// Structural type so both DOM and React keyboard events qualify.
interface FindShortcutKeyEvent {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string;
}

// toLowerCase: CapsLock yields "F".
export function isFindShortcut(e: FindShortcutKeyEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f";
}

// Shift is deliberately not checked: Shift+G means find-previous, so callers
// read e.shiftKey for direction. toLowerCase: Shift/CapsLock yield "G".
export function isFindNextShortcut(e: FindShortcutKeyEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g";
}
