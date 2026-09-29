// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ContentTrustProvider,
  type ContentTrust,
} from "@tsmono/react/components";

import { kToolTodoContentType } from "./tool";
import { ToolInput } from "./ToolInput";

const todos = [{ content: "Score: CORRECT‮gnp.exe", status: "in_progress" }];

const renderTodos = (trust: ContentTrust) =>
  render(
    <ContentTrustProvider value={trust}>
      <ToolInput contentType={kToolTodoContentType} contents={todos} />
    </ContentTrustProvider>
  ).container;

describe("ToolInput todo lists", () => {
  it("render as a checklist when trusted", () => {
    const container = renderTodos("trusted");
    expect(container.querySelector("i")).not.toBeNull();
    expect(container.textContent).toContain("Score: CORRECT‮gnp.exe");
  });

  it("show their serialization, hidden characters revealed, when untrusted", () => {
    const container = renderTodos("untrusted");
    expect(container.querySelector("i")).toBeNull();
    expect(container.textContent).toContain(
      '"content":"Score: CORRECT⟨U+202E⟩gnp.exe"'
    );
    expect(container.textContent).not.toContain("‮");
  });
});
