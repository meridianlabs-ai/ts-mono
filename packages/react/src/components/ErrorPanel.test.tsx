// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ComponentIconProvider, ComponentIcons } from "./ComponentIconContext";
import { ErrorPanel } from "./ErrorPanel";

const mockIcons: ComponentIcons = {
  chevronDown: "bi-chevron-down",
  chevronUp: "bi-chevron-up",
  clearText: "bi-x",
  close: "bi-x-lg",
  code: "bi-code",
  confirm: "bi-check",
  copy: "bi-copy",
  error: "bi-exclamation-circle",
  menu: "bi-list",
  next: "bi-chevron-right",
  noSamples: "bi-file-earmark",
  play: "bi-play",
  previous: "bi-chevron-left",
  toggleRight: "bi-chevron-right",
};

const renderWithIcons = (ui: React.ReactElement) =>
  render(
    <ComponentIconProvider icons={mockIcons}>{ui}</ComponentIconProvider>
  );

describe("ErrorPanel", () => {
  it("renders the title", () => {
    const { container } = renderWithIcons(
      <ErrorPanel title="Server Error" error={{ message: "Connection failed" }} />
    );
    expect(container.textContent).toContain("Server Error");
  });

  it("renders the error message", () => {
    const { container } = renderWithIcons(
      <ErrorPanel title="Error" error={{ message: "Something broke" }} />
    );
    expect(container.textContent).toContain("Something broke");
  });

  it("shows stack trace by default when provided", () => {
    const { container } = renderWithIcons(
      <ErrorPanel
        title="Error"
        error={{ message: "fail", stack: "at foo.ts:10\nat bar.ts:20" }}
      />
    );
    expect(container.textContent).toContain("at foo.ts:10");
  });

  it("hides stack trace when displayStack is false", () => {
    const { container } = renderWithIcons(
      <ErrorPanel
        title="Error"
        error={{
          message: "fail",
          stack: "at foo.ts:10",
          displayStack: false,
        }}
      />
    );
    expect(container.textContent).not.toContain("at foo.ts:10");
  });
});
