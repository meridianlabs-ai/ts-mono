// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { EventNavsPicker } from "./EventNavsPicker";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

it.each([false, true])(
  "keeps navigation usable in its rendering root (shadow=%s)",
  (shadow) => {
    const host = document.createElement("div");
    host.setAttribute("role", "dialog");
    document.body.append(host);
    const root = shadow ? host.attachShadow({ mode: "open" }) : document.body;
    const mount = document.createElement("div");
    root.append(mount);
    const selected = vi.fn();
    render(
      <EventNavsPicker
        navs={[
          { id: "summary", title: "Summary", target: "summary" },
          { id: "messages", title: "Messages", target: "messages" },
        ]}
        selectedNav="summary"
        setSelectedNav={selected}
      />,
      { container: mount }
    );
    fireEvent.click(within(mount).getByRole("button", { name: "Summary" }));
    const option = root.querySelectorAll('[role="option"]')[1];
    expect(option).toBeDefined();
    if (!option) throw new Error("menu escaped the rendering root");
    fireEvent.click(option);
    expect(selected).toHaveBeenCalledWith("messages");
    expect(root.querySelector('[role="listbox"]')).toBeNull();
  }
);
