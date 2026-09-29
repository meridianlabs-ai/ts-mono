// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { startTransition, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ContentTrustProvider, type ContentTrust } from "./ContentTrust";
import { JSONPanel } from "./JsonPanel";

// The highlighter's revocation on its own: with the untrusted-code marker
// matching nothing, only disconnecting the observer in the commit that
// revokes trust keeps newly untrusted code plain.
vi.mock("./ContentTrust", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ContentTrust")>()),
  kUntrustedContentSelector: "[data-matches-nothing]",
}));

describe("usePrismHighlight", () => {
  it("stops observing in the commit that revokes trust", async () => {
    let show: (value: number, trust: ContentTrust) => void = () => {};
    const Switcher = () => {
      const [state, setState] = useState({
        value: 1,
        trust: "trusted" as ContentTrust,
      });
      // A transition defers passive effects past the DOM update, which the
      // observer sees first.
      show = (value, trust) => {
        startTransition(() => setState({ value, trust }));
      };
      return (
        <ContentTrustProvider value={state.trust}>
          <JSONPanel data={{ value: state.value }} />
        </ContentTrustProvider>
      );
    };
    const { container } = render(<Switcher />);
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
});
