// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { FC, ReactNode, useState } from "react";
import { describe, expect, it } from "vitest";

import { ComponentStateProvider } from "../state/ComponentStateContext";
import { makeReactiveStateHooks } from "../test/component-state-hooks";

import { LightboxCarousel } from "./LightboxCarousel";

// LightboxCarousel drives its state through useProperty, so a set has to
// actually re-render for the lightbox to open or the slide to advance.
const Wrapper: FC<{ children: ReactNode }> = ({ children }) => {
  const [hooks] = useState(makeReactiveStateHooks);
  return (
    <ComponentStateProvider hooks={hooks}>{children}</ComponentStateProvider>
  );
};

const slides = [
  { label: "first", render: () => <div>slide-0-body</div> },
  { label: "second", render: () => <div>slide-1-body</div> },
];

const renderOpened = () => {
  render(
    <Wrapper>
      <LightboxCarousel id="lightbox" slides={slides} />
    </Wrapper>
  );
  fireEvent.click(screen.getByText("first"));
  return screen.getByRole("dialog");
};

describe("LightboxCarousel", () => {
  it("wraps to the first slide when advancing past the last", () => {
    const dialog = renderOpened();

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByText("slide-1-body")).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByText("slide-0-body")).toBeTruthy();
  });

  it("wraps to the last slide when going back from the first", () => {
    const dialog = renderOpened();

    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(screen.getByText("slide-1-body")).toBeTruthy();
  });

  it("closes on Escape from a slide that cancels the key", () => {
    renderOpened();

    // The terminal player cancels Escape on document, after this bubbles.
    fireEvent.keyDown(screen.getByText("slide-0-body"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("unmounts its slide when the dialog closes natively", () => {
    const dialog = renderOpened();
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("no dialog");

    // What the browser does on an Escape with focus on <body>.
    dialog.close();
    fireEvent(dialog, new Event("close"));
    expect(screen.queryByText("slide-0-body")).toBeNull();
  });
});
