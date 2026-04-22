import { describe, expect, it } from "vitest";

import type {
  MetadataField,
  ScannerResultField,
  ViewerConfig,
} from "@tsmono/inspect-common/types";

import {
  kDefaultFields,
  kDefaultResolvedView,
  resolveScannerResultView,
} from "./viewerConfig";

const builtin = (
  name: ScannerResultField["name"],
  extra: Partial<ScannerResultField> = {}
): ScannerResultField => ({
  kind: "builtin",
  name,
  collapsed: false,
  ...extra,
});

const meta = (
  key: string,
  extra: Partial<MetadataField> = {}
): MetadataField => ({
  kind: "metadata",
  key,
  collapsed: false,
  ...extra,
});

describe("resolveScannerResultView", () => {
  it("returns the built-in default when viewer is null/undefined", () => {
    expect(resolveScannerResultView(null, "any")).toEqual(kDefaultResolvedView);
    expect(resolveScannerResultView(undefined, "any")).toEqual(
      kDefaultResolvedView
    );
  });

  it("returns the built-in default when no pattern matches", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "audit_*": { fields: [builtin("value")], exclude_fields: [] },
      },
    };
    expect(resolveScannerResultView(viewer, "is_ascii")).toEqual(
      kDefaultResolvedView
    );
  });

  it("applies a `*` wildcard to any scanner", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": {
          fields: [builtin("explanation"), builtin("value")],
          exclude_fields: [],
        },
      },
    };
    const resolved = resolveScannerResultView(viewer, "anything");
    expect(resolved.fields).toEqual([builtin("explanation"), builtin("value")]);
    expect(resolved.excludedMetadataKeys).toEqual([]);
  });

  it("exact name beats `*`", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": { fields: [builtin("explanation")], exclude_fields: [] },
        is_ascii: { fields: [builtin("value")], exclude_fields: [] },
      },
    };
    expect(resolveScannerResultView(viewer, "is_ascii").fields).toEqual([
      builtin("value"),
    ]);
  });

  it("prefix glob beats `*`, exact name beats prefix glob", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": { fields: [builtin("explanation")], exclude_fields: [] },
        "audit_*": { fields: [builtin("value")], exclude_fields: [] },
        audit_judge: { fields: [builtin("answer")], exclude_fields: [] },
      },
    };
    expect(resolveScannerResultView(viewer, "audit_judge").fields).toEqual([
      builtin("answer"),
    ]);
    expect(resolveScannerResultView(viewer, "audit_other").fields).toEqual([
      builtin("value"),
    ]);
    expect(resolveScannerResultView(viewer, "is_ascii").fields).toEqual([
      builtin("explanation"),
    ]);
  });

  it("breaks specificity ties by insertion order (earlier wins)", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "audit_*": { fields: [builtin("value")], exclude_fields: [] },
        "*_judge": { fields: [builtin("answer")], exclude_fields: [] },
      },
    };
    // Both patterns have specificity 6 (`audit_` and `_judge` are 6 chars).
    // `audit_*` is declared first → wins.
    expect(resolveScannerResultView(viewer, "audit_judge").fields).toEqual([
      builtin("value"),
    ]);
  });

  it("unions exclude_fields across every matching pattern", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": {
          fields: null,
          exclude_fields: [meta("_internal_state")],
        },
        "audit_*": {
          fields: [builtin("value"), builtin("metadata")],
          exclude_fields: [meta("_debug")],
        },
      },
    };
    const resolved = resolveScannerResultView(viewer, "audit_judge");
    // `fields` comes from `audit_*`; `exclude_fields` unions both tiers.
    expect(resolved.fields).toEqual([builtin("value"), builtin("metadata")]);
    expect(new Set(resolved.excludedMetadataKeys)).toEqual(
      new Set(["_internal_state", "_debug"])
    );
  });

  it("`exclude_fields` removes matching builtin sections from the resolved list", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": { fields: null, exclude_fields: [builtin("answer")] },
      },
    };
    const resolved = resolveScannerResultView(viewer, "any");
    expect(
      resolved.fields.map((f) => (f.kind === "builtin" ? f.name : f.key))
    ).not.toContain("answer");
  });

  it("promoted MetadataField key is added to excludedMetadataKeys", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": {
          fields: [meta("summary"), builtin("metadata")],
          exclude_fields: [],
        },
      },
    };
    const resolved = resolveScannerResultView(viewer, "any");
    expect(resolved.excludedMetadataKeys).toEqual(["summary"]);
  });

  it("accepts string shorthand in fields and exclude_fields", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": {
          fields: ["explanation", "metadata.summary", "value"],
          exclude_fields: ["answer", "metadata._internal"],
        },
      },
    };
    const resolved = resolveScannerResultView(viewer, "any");
    expect(resolved.fields).toEqual([
      builtin("explanation"),
      meta("summary"),
      builtin("value"),
    ]);
    expect(new Set(resolved.excludedMetadataKeys)).toEqual(
      new Set(["summary", "_internal"])
    );
  });

  it("drops entries with unknown kind or invalid builtin names", () => {
    const viewer = {
      scanner_result_view: {
        "*": {
          fields: [
            { kind: "bogus", name: "value" },
            builtin("value"),
            "not_a_real_builtin",
          ],
          exclude_fields: [],
        },
      },
    } as unknown as ViewerConfig;
    const resolved = resolveScannerResultView(viewer, "any");
    expect(resolved.fields).toEqual([builtin("value")]);
  });

  it("accepts a bare ScannerResultView as the scanner_result_view shorthand", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        fields: [builtin("value"), builtin("explanation")],
        exclude_fields: [],
      },
    };
    const resolved = resolveScannerResultView(viewer, "any");
    expect(resolved.fields).toEqual([builtin("value"), builtin("explanation")]);
  });

  it("uses the default fields when the matching entry has fields=null", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": { fields: null, exclude_fields: [builtin("answer")] },
      },
    };
    const resolved = resolveScannerResultView(viewer, "any");
    // Default order minus `answer`.
    expect(resolved.fields.map((f) => f.kind === "builtin" && f.name)).toEqual(
      kDefaultFields
        .filter((f) => f.kind !== "builtin" || f.name !== "answer")
        .map((f) => f.kind === "builtin" && f.name)
    );
  });
});
