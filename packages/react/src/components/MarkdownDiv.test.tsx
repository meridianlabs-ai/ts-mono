// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownDiv } from "./MarkdownDiv";

describe("MarkdownDiv render coordination", () => {
  it("keeps callbacks independent for duplicate markdown with different post-processing", async () => {
    render(
      <>
        <MarkdownDiv
          markdown="same **markdown**"
          postProcess={(html) =>
            `<section data-testid="first">${html}</section>`
          }
        />
        <MarkdownDiv
          markdown="same **markdown**"
          postProcess={(html) => `<aside data-testid="second">${html}</aside>`}
        />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId("first").innerHTML).toContain(
        "<strong>markdown</strong>"
      );
      expect(screen.getByTestId("second").innerHTML).toContain(
        "<strong>markdown</strong>"
      );
    });
  });
});
