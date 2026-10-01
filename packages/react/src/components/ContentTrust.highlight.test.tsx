// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentTrustProvider, type ContentTrust } from "./ContentTrust";
import { JSONPanel } from "./JsonPanel";
import { SourceCodePanel } from "./SourceCodePanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const withTrust = (trust: ContentTrust, children: ReactNode) => (
  <ContentTrustProvider value={trust}>{children}</ContentTrustProvider>
);

const panels = {
  JSONPanel: (value: number) => <JSONPanel data={{ value }} />,
  SourceCodePanel: (value: number) => (
    <SourceCodePanel code={`x = ${value}`} language="python" />
  ),
};

describe.each(Object.entries(panels))("highlighted %s", (_name, panel) => {
  it("shows updated content", async () => {
    const { container, rerender } = render(withTrust("trusted", panel(1)));
    await waitFor(() => {
      expect(container.querySelector(".token")).not.toBeNull();
    });

    rerender(withTrust("trusted", panel(2)));
    const code = container.querySelector("code");
    expect(code?.textContent).toContain("2");
    expect(code?.textContent).not.toContain("1");
  });

  it("switches to untrusted content", async () => {
    const { container, rerender } = render(withTrust("trusted", panel(1)));
    await waitFor(() => {
      expect(container.querySelector(".token")).not.toBeNull();
    });

    rerender(withTrust("untrusted", panel(1)));
    expect(container.querySelector(".token")).toBeNull();
    expect(container.querySelector("code")?.textContent).toContain("1");
  });
});
