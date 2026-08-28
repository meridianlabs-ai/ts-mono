import { describe, expect, it, vi } from "vitest";

import { resolveAttachments } from "./attachments";

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
    expect(
      resolveAttachments("tc://nope", attachments, onFailedResolve)
    ).toBe("tc://nope");
    expect(onFailedResolve).toHaveBeenCalledWith("nope");
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
