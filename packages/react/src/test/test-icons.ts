import { ComponentIcons } from "../components/ComponentIconContext";

// The real mappings live in each host app (apps/inspect, apps/scout), which
// this package cannot import from. Values are the key name so assertions can
// identify which icon rendered.
export const testIcons: ComponentIcons = {
  arrowDown: "icon-arrowDown",
  arrowUp: "icon-arrowUp",
  chevronDown: "icon-chevronDown",
  chevronUp: "icon-chevronUp",
  clearText: "icon-clearText",
  close: "icon-close",
  code: "icon-code",
  confirm: "icon-confirm",
  copy: "icon-copy",
  error: "icon-error",
  menu: "icon-menu",
  next: "icon-next",
  noSamples: "icon-noSamples",
  play: "icon-play",
  previous: "icon-previous",
  toggleRight: "icon-toggleRight",
};
