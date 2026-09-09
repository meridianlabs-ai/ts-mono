import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { testAssistantMessage } from "@tsmono/inspect-common/testing";
import { MessageContent } from "@tsmono/inspect-components/chat";
import {
  ComponentIconProvider,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, testIcons } from "@tsmono/react/testing";

import { resolveSample } from "./sampleFetch";

afterEach(cleanup);

describe("sample attachment rendering", () => {
  it.each(["attachment://constructor", "tc://constructor"])(
    "keeps %s readable when the raw attachment value is an object",
    async (ref) => {
      const sample = resolveSample({
        messages: [testAssistantMessage({ content: ref })],
        attachments: { constructor: { invalid: true } },
      });
      const [message] = sample.messages;
      if (!message) throw new Error("Missing fixture message");

      render(
        <ComponentStateProvider hooks={makeStateHooks()}>
          <ComponentIconProvider icons={testIcons}>
            <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
              <MessageContent contents={message.content} />
            </ComponentNavigationProvider>
          </ComponentIconProvider>
        </ComponentStateProvider>
      );

      expect(await screen.findByText(ref)).toBeInTheDocument();
      expect(message.content).toBe(ref);
    }
  );
});
