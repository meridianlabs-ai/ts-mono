// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApplicationIcons } from "../appearance/icons";

import { ViewerOptionsButton } from "./ViewerOptionsButton";

afterEach(cleanup);

describe("ViewerOptionsButton", () => {
  test("adorns the options button when a background sync failed", () => {
    render(
      <ViewerOptionsButton
        showing={false}
        setShowing={vi.fn()}
        error={new Error("listing refresh failed")}
      />
    );

    const button = screen.getByRole("button");
    expect(button.title).toContain("listing refresh failed");
    expect(
      button.querySelector(`.${ApplicationIcons.error.split(" ").join(".")}`)
    ).not.toBeNull();
  });

  test("keeps opening viewer options when adorned", () => {
    const setShowing = vi.fn();
    render(
      <ViewerOptionsButton
        showing={false}
        setShowing={setShowing}
        error={new Error("listing refresh failed")}
      />
    );

    fireEvent.click(screen.getByRole("button"));
    expect(setShowing).toHaveBeenCalledWith(true);
  });
});
