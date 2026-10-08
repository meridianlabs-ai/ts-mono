// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { ReactNode, startTransition, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentTrustProvider, type ContentTrust } from "./ContentTrustContext";
import { JSONPanel } from "./JsonPanel";
import { SourceCodePanel } from "./SourceCodePanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const withTrust = (trust: ContentTrust, children: ReactNode) => (
  <ContentTrustProvider value={trust}>{children}</ContentTrustProvider>
);

// Renders `view(1, "trusted")`; `show` switches it in a transition, which
// defers passive effects past the DOM update that a MutationObserver sees.
const renderSwitchable = (
  view: (value: number, trust: ContentTrust) => ReactNode
) => {
  let show: (value: number, trust: ContentTrust) => void = () => {};
  const Switcher = () => {
    const [state, setState] = useState<{ value: number; trust: ContentTrust }>({
      value: 1,
      trust: "trusted",
    });
    show = (value, trust) => {
      startTransition(() => setState({ value, trust }));
    };
    return view(state.value, state.trust);
  };
  const { container } = render(<Switcher />);
  return {
    container,
    show: (value: number, trust: ContentTrust) => show(value, trust),
  };
};

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

  it("doesn't highlight content that turns untrusted in a transition", async () => {
    const { container, show } = renderSwitchable((value, trust) =>
      withTrust(trust, panel(value))
    );
    await waitFor(() => {
      expect(container.querySelector(".token")).not.toBeNull();
    });

    show(2, "untrusted");
    await waitFor(() => {
      expect(container.querySelector("code")?.textContent).toContain("2");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector(".token")).toBeNull();
  });

  it("drops a highlight queued before trust was revoked", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    const { container, rerender } = render(withTrust("trusted", panel(1)));
    await waitFor(() => {
      expect(frames.length).toBeGreaterThan(0);
    });

    rerender(withTrust("untrusted", panel(1)));
    frames.forEach((frame) => frame(0));
    expect(container.querySelector(".token")).toBeNull();
  });
});
