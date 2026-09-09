import { isRecord } from "@tsmono/util";

/**
 * Readers for form-control events. The vscode-elements web components carry
 * `value` and `checked` on the custom element itself, so an event's target is
 * `<vscode-textfield>` rather than the `<input>` inside its shadow root —
 * these read the property off whatever the target actually is instead of
 * claiming a DOM class it isn't.
 */

type TargetedEvent = { target: EventTarget | null };

export const eventValue = (e: TargetedEvent): string => {
  const target: unknown = e.target;
  return isRecord(target) && typeof target.value === "string"
    ? target.value
    : "";
};

export const eventChecked = (e: TargetedEvent): boolean => {
  const target: unknown = e.target;
  return isRecord(target) && target.checked === true;
};
