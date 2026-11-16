import { describe, expect, it, vi } from "vitest";

import {
  testSubtaskEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { ContentImage, ContentText } from "@tsmono/inspect-common/types";

import { resolveAttachments, resolveEventAttachments } from "./attachments";

const attachments = { abc123: "resolved content" };

describe("resolveAttachments", () => {
  it("resolves attachment:// strings", () => {
    expect(resolveAttachments("attachment://abc123", attachments)).toBe(
      "resolved content"
    );
  });

  it("rewrites legacy tc:// refs and resolves them", () => {
    expect(resolveAttachments("tc://abc123", attachments)).toBe(
      "resolved content"
    );
  });

  it("returns the original string on a miss and fires onFailedResolve", () => {
    const onFailedResolve = vi.fn();
    expect(
      resolveAttachments("attachment://nope", attachments, onFailedResolve)
    ).toBe("attachment://nope");
    expect(onFailedResolve).toHaveBeenCalledWith("nope");
  });

  it("returns the original (un-rewritten) tc:// string on a miss", () => {
    const onFailedResolve = vi.fn();
    expect(resolveAttachments("tc://nope", attachments, onFailedResolve)).toBe(
      "tc://nope"
    );
    expect(onFailedResolve).toHaveBeenCalledWith("nope");
  });

  it("fires onFailedResolve for misses nested in arrays and objects", () => {
    const onFailedResolve = vi.fn();
    resolveAttachments(
      {
        list: ["attachment://gone"],
        nested: { ref: "attachment://also-gone" },
      },
      attachments,
      onFailedResolve
    );
    expect(onFailedResolve).toHaveBeenCalledWith("gone");
    expect(onFailedResolve).toHaveBeenCalledWith("also-gone");
  });

  it("resolves refs nested in arrays and objects, leaving other values alone", () => {
    const input = {
      list: ["attachment://abc123", "plain", 42],
      nested: { ref: "attachment://abc123", keep: null },
    };
    expect(resolveAttachments(input, attachments)).toEqual({
      list: ["resolved content", "plain", 42],
      nested: { ref: "resolved content", keep: null },
    });
  });

  it("preserves identity when nothing resolves", () => {
    const input = { list: ["plain"], nested: { keep: true } };
    expect(resolveAttachments(input, attachments)).toBe(input);
  });

  it("preserves identity of unchanged subtrees inside a changed parent", () => {
    const unchangedChild = { keep: "plain" };
    const input = { unchangedChild, ref: "attachment://abc123" };
    const result = resolveAttachments(input, attachments);
    expect(result).not.toBe(input);
    expect(result.ref).toBe("resolved content");
    expect(result.unchangedChild).toBe(unchangedChild);
  });

  it("passes Date and RegExp instances through untouched", () => {
    const date = new Date(0);
    const regex = /x/;
    const result = resolveAttachments({ date, regex }, attachments);
    expect(result.date).toBe(date);
    expect(result.regex).toBe(regex);
  });

  it("passes null and undefined through", () => {
    expect(resolveAttachments(null, attachments)).toBeNull();
    expect(resolveAttachments(undefined, attachments)).toBeUndefined();
  });
});

// Attachment ids are the suffix of a log-authored string; one that names an
// Object.prototype member is a miss, never the inherited builtin.
describe("resolveAttachments prototype-named ids", () => {
  it.each([
    "constructor",
    "__proto__",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ])("treats attachment://%s as a miss", (id) => {
    const onFailedResolve = vi.fn();
    const ref = `attachment://${id}`;
    expect(resolveAttachments(ref, attachments, onFailedResolve)).toBe(ref);
    expect(onFailedResolve).toHaveBeenCalledWith(id);
    expect(
      resolveAttachments({ content: [ref] }, attachments, onFailedResolve)
    ).toEqual({ content: [ref] });
  });

  it("resolves an own attachment stored under such an id", () => {
    expect(
      resolveAttachments("attachment://constructor", {
        constructor: "own content",
      })
    ).toBe("own content");
  });

  it("ignores attachments planted on Object.prototype", () => {
    Object.defineProperty(Object.prototype, "planted_attachment", {
      value: "polluted",
      configurable: true,
      writable: true,
    });
    try {
      expect(
        resolveAttachments("attachment://planted_attachment", attachments)
      ).toBe("attachment://planted_attachment");
    } finally {
      Reflect.deleteProperty(Object.prototype, "planted_attachment");
    }
  });
});

describe.each(["attachment://", "tc://"])(
  "resolveAttachments %s value validation",
  (protocol) => {
    it.each([
      { name: "object", value: { invalid: true } },
      { name: "array", value: ["invalid"] },
      { name: "null", value: null },
      { name: "number", value: 42 },
      { name: "boolean", value: false },
      { name: "undefined", value: undefined },
    ])("treats an own $name value as a miss", ({ value }) => {
      const onFailedResolve = vi.fn();
      const input = { content: [`${protocol}constructor`] };

      expect(
        resolveAttachments(input, { constructor: value }, onFailedResolve)
      ).toBe(input);
      expect(onFailedResolve).toHaveBeenCalledExactlyOnceWith("constructor");
    });

    it.each(["constructor", "__proto__", "toString"])(
      "resolves an own empty string under %s",
      (id) => {
        const onFailedResolve = vi.fn();
        expect(
          resolveAttachments(`${protocol}${id}`, { [id]: "" }, onFailedResolve)
        ).toBe("");
        expect(onFailedResolve).not.toHaveBeenCalled();
      }
    );
  }
);

// inspect_ai's reader leaves tool result text as written (its writer never
// puts references there), so a tool that returns "attachment://<key>" is
// shown as that literal text.
describe.each(["attachment://", "tc://"])(
  "resolveEventAttachments %s",
  (protocol) => {
    const ref = `${protocol}abc123`;
    const text = (value: string) =>
      ({ type: "text", text: value }) satisfies ContentText;
    const image = (value: string) =>
      ({ type: "image", image: value, detail: "auto" }) satisfies ContentImage;

    it.each([
      { name: "a string", result: ref },
      { name: "a single ContentText", result: text(ref) },
      { name: "a list", result: [text(ref), text("plain")] },
    ])("leaves tool result text in $name as written", ({ result }) => {
      const event = testToolEvent({ result });
      expect(resolveEventAttachments(event, attachments).result).toEqual(
        result
      );
    });

    it("resolves a tool result image, alone and in a list", () => {
      expect(
        resolveEventAttachments(
          testToolEvent({ result: image(ref) }),
          attachments
        ).result
      ).toEqual(image("resolved content"));
      expect(
        resolveEventAttachments(
          testToolEvent({ result: [text(ref), image(ref)] }),
          attachments
        ).result
      ).toEqual([text(ref), image("resolved content")]);
    });

    it("still resolves the tool event's other fields", () => {
      const resolved = resolveEventAttachments(
        testToolEvent({ result: ref, arguments: { cmd: ref } }),
        attachments
      );
      expect(resolved.arguments).toEqual({ cmd: "resolved content" });
    });

    it("applies to lists of events and to nested events", () => {
      const tool = testToolEvent({ result: ref, arguments: { cmd: ref } });
      const subtask = testSubtaskEvent({ events: [tool] });
      expect(resolveEventAttachments([subtask], attachments)).toEqual([
        {
          ...subtask,
          events: [{ ...tool, arguments: { cmd: "resolved content" } }],
        },
      ]);
    });
  }
);
