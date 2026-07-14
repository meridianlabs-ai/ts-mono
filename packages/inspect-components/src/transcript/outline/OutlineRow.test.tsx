// @vitest-environment jsdom
//
// The outline row's contract for deep links: `getEventUrl` returns a router
// route. `renderLink` consumers receive that route untouched (in-app
// navigation), while the raw `<a href>` fallback applies `toShareUrl` so the
// href doesn't escape the hash router as a literal path.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EventNode } from "../types";

import { OutlineRow } from "./OutlineRow";

const kRoute = "/logs/file.eval/samples/sample/s1/1/transcript?event=event-1";
const toShareUrl = (route: string) => `https://host.example/page#${route}`;

const makeNode = () =>
  new EventNode(
    "event-1",
    {
      event: "info",
      source: "",
      data: "",
      timestamp: "",
      pending: false,
      working_start: 0,
      span_id: null,
      uuid: null,
      metadata: null,
    },
    0
  );

describe("OutlineRow deep links", () => {
  afterEach(() => cleanup());

  it("passes the bare route to renderLink for in-app navigation", () => {
    render(
      <OutlineRow
        node={makeNode()}
        getEventUrl={() => kRoute}
        toShareUrl={toShareUrl}
        renderLink={(url, children) => <a href={`#link:${url}`}>{children}</a>}
      />
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      `#link:${kRoute}`
    );
  });

  it("applies toShareUrl to the raw anchor fallback", () => {
    render(
      <OutlineRow
        node={makeNode()}
        getEventUrl={() => kRoute}
        toShareUrl={toShareUrl}
      />
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      toShareUrl(kRoute)
    );
  });

  it("keeps the raw route in the anchor when no toShareUrl is given", () => {
    render(<OutlineRow node={makeNode()} getEventUrl={() => kRoute} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(kRoute);
  });
});
