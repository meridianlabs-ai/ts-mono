// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

const renderModal = (props: Partial<Parameters<typeof Modal>[0]> = {}) =>
  render(
    <Modal show onHide={() => {}} title="My Title" id="test-modal" {...props}>
      {props.children ?? <button>inner</button>}
    </Modal>
  );

const cancelEvent = () => new Event("cancel", { cancelable: true });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Modal", () => {
  it("is a dialog labelled by its title", () => {
    renderModal();
    expect(screen.getByRole("dialog", { name: "My Title" })).toBeDefined();
  });

  it("generates unique title ids when no id is provided", () => {
    render(
      <>
        <Modal show onHide={() => {}} title="First">
          <button>first body</button>
        </Modal>
        <Modal show onHide={() => {}} title="Second">
          <button>second body</button>
        </Modal>
      </>
    );
    expect(screen.getByRole("dialog", { name: "First" })).toBeDefined();
    expect(screen.getByRole("dialog", { name: "Second" })).toBeDefined();
  });

  it("exposes a named close button that hides it", () => {
    const onHide = vi.fn();
    renderModal({ onHide });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it("hides on Escape (the dialog's cancel) instead of closing itself", () => {
    const onHide = vi.fn();
    renderModal({ onHide });
    const event = cancelEvent();
    screen.getByRole("dialog").dispatchEvent(event);
    expect(onHide).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("reports a close it didn't ask for, not one it has since reopened from", () => {
    const onHide = vi.fn();
    renderModal({ onHide });
    const dialog = screen.getByRole<HTMLDialogElement>("dialog");
    dialog.dispatchEvent(new Event("close"));
    expect(onHide).not.toHaveBeenCalled();
    dialog.close();
    dialog.dispatchEvent(new Event("close"));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it("hides on a click on the backdrop, not inside the dialog", () => {
    const onHide = vi.fn();
    renderModal({ onHide });
    fireEvent.click(screen.getByRole("button", { name: "inner" }));
    expect(onHide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("presentation"));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it("submits on Enter from text inputs, not from buttons", () => {
    const onSubmit = vi.fn();
    renderModal({
      onSubmit,
      children: <input aria-label="Name" />,
      footer: <button type="button">Cancel</button>,
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), {
      key: "Enter",
    });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), {
      key: "Enter",
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("uses the latest callbacks", () => {
    const firstHide = vi.fn();
    const nextHide = vi.fn();
    const ui = (onHide: () => void) => (
      <Modal show onHide={onHide} title="T">
        <span />
      </Modal>
    );
    const { rerender } = render(ui(firstHide));
    rerender(ui(nextHide));
    screen.getByRole("dialog").dispatchEvent(cancelEvent());
    expect(firstHide).not.toHaveBeenCalled();
    expect(nextHide).toHaveBeenCalledOnce();
  });

  it("focuses the [data-autofocus] element once open", async () => {
    renderModal({
      children: (
        <>
          <button>first</button>
          <button data-autofocus>autofocus me</button>
        </>
      ),
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "autofocus me" })
      )
    );
  });

  it("renders nothing when not shown", () => {
    renderModal({ show: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
