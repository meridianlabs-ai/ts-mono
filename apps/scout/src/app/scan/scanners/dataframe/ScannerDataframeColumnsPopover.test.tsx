// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { createTestWrapperWithStore } from "../../../../test/test-utils";

import { ScannerDataframeColumnsPopover } from "./ScannerDataframeColumnsPopover";

describe("ScannerDataframeColumnsPopover", () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it("focuses the preset name input when saving starts", async () => {
    const { wrapper: Wrapper, store } = createTestWrapperWithStore();
    store.getState().setDataframeShowFilterColumns(true);
    store.getState().setDataframeFilterColumns(["uuid"]);
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);

    render(
      <MemoryRouter>
        <Wrapper>
          <ScannerDataframeColumnsPopover positionEl={anchor} />
        </Wrapper>
      </MemoryRouter>
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Save current..." })
    );

    expect(document.activeElement).toBe(
      screen.getByPlaceholderText("Preset name")
    );
  });
});
