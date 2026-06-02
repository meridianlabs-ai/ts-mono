import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ComponentIconProvider } from "./ComponentIconContext";
import { ErrorPanel } from "./ErrorPanel";
import { testIcons } from "./__testing__/icons";

const renderWithIcons = (ui: React.ReactElement) =>
  render(
    <ComponentIconProvider icons={testIcons}>{ui}</ComponentIconProvider>
  );

describe("ErrorPanel", () => {
  it("renders the title", () => {
    const { getByText } = renderWithIcons(
      <ErrorPanel title="Server Error" error={{ message: "Connection failed" }} />
    );
    expect(getByText("Server Error")).toBeInTheDocument();
  });

  it("renders the error message", () => {
    const { getByText } = renderWithIcons(
      <ErrorPanel title="Error" error={{ message: "Something broke" }} />
    );
    expect(getByText("Something broke")).toBeInTheDocument();
  });

  it("shows stack trace by default when provided", () => {
    const { getByText } = renderWithIcons(
      <ErrorPanel
        title="Error"
        error={{ message: "fail", stack: "at foo.ts:10\nat bar.ts:20" }}
      />
    );
    expect(getByText(/at foo.ts:10/)).toBeInTheDocument();
  });

  it("hides stack trace when displayStack is false", () => {
    const { queryByText } = renderWithIcons(
      <ErrorPanel
        title="Error"
        error={{
          message: "fail",
          stack: "at foo.ts:10",
          displayStack: false,
        }}
      />
    );
    expect(queryByText(/at foo.ts:10/)).not.toBeInTheDocument();
  });
});
