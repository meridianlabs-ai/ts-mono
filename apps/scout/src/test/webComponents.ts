import { fireEvent, waitFor, within } from "@testing-library/react";
import { screen } from "shadow-dom-testing-library";

// Queries into the real vscode-elements web components, whose form controls
// live in shadow roots that testing-library's own queries never see.

const hostOf = (el: Element): Element | null => {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
};

const isInput = (el: Element | null | undefined): el is HTMLInputElement =>
  el instanceof HTMLInputElement;

const isTextarea = (
  el: Element | null | undefined
): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement;

const hasChecked = (el: Element): el is Element & { checked: boolean } =>
  "checked" in el && typeof el.checked === "boolean";

export const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`No element with id "${id}"`);
  return el;
};

/** The one `<tag>` on the page; throws if there are none or several. */
export const onlyElement = (tag: string): Element => {
  const all = document.querySelectorAll(tag);
  if (all.length !== 1) {
    throw new Error(`Expected one <${tag}>, found ${all.length}`);
  }
  const [el] = all;
  if (!el) throw new Error(`Expected one <${tag}>`);
  return el;
};

/** The `<textarea>` inside a `vscode-textarea` host. */
export const innerTextarea = (host: Element): HTMLTextAreaElement => {
  const el = host.shadowRoot?.querySelector("textarea");
  if (!isTextarea(el))
    throw new Error(`${host.tagName} has no shadow textarea`);
  return el;
};

/** A textfield's inner input, found by its placeholder. */
export const inputByPlaceholder = (placeholder: string): HTMLInputElement => {
  const el = screen.getByShadowPlaceholderText(placeholder);
  if (!isInput(el)) throw new Error(`"${placeholder}" is not an input`);
  return el;
};

export const queryInputByPlaceholder = (
  placeholder: string
): HTMLInputElement | null => {
  const el = screen.queryByShadowPlaceholderText(placeholder);
  return isInput(el) ? el : null;
};

/** The `vscode-radio` host whose label reads `label`; click it to select. */
export const radio = (label: string): Element & { checked: boolean } => {
  for (const el of screen.getAllByShadowText(label)) {
    const host = hostOf(el);
    if (host?.tagName === "VSCODE-RADIO" && hasChecked(host)) return host;
  }
  throw new Error(`No vscode-radio labelled "${label}"`);
};

/**
 * Pick an option in a `vscode-single-select` the way a user does: open the
 * dropdown, click the option. Waits for the slotted option first, since
 * options built from fetched data arrive asynchronously.
 */
export const selectOption = async (
  host: HTMLElement,
  optionLabel: string
): Promise<void> => {
  await within(host).findByText(optionLabel);
  fireEvent.click(host);
  await waitFor(() => {
    const option = screen
      .getAllByShadowText(optionLabel)
      .find((el) => hostOf(el) === host);
    if (!option) throw new Error(`"${optionLabel}" is not open in ${host.id}`);
    fireEvent.click(option);
  });
};

/** A `vscode-button` by its slotted text; a click on the text reaches the host. */
export const button = (label: string): Element => {
  const el = screen
    .getAllByText(label)
    .find((candidate) => candidate.closest("vscode-button") !== null);
  if (!el) throw new Error(`No vscode-button labelled "${label}"`);
  return el;
};
