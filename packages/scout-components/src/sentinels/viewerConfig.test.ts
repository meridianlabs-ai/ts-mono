import { describe, expect, it } from "vitest";

import type {
  MetadataField,
  ScannerResultField,
  ScannerResultView,
  ViewerConfig,
} from "@tsmono/inspect-common/types";

import { scannerGlobCompatibility } from "./scannerGlobCompatibility.fixture";
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

/** All builtin field names in default order — for convenient expected values. */
const defaultBuiltinNames = kDefaultFields.map((f) =>
  f.kind === "builtin" ? f.name : ""
);

/** Helper: build the expected fields list under the "pin + append defaults" rule. */
const withAppendedDefaults = (
  pinned: ReadonlyArray<ScannerResultField | MetadataField>
): ReadonlyArray<ScannerResultField | MetadataField> => {
  const mentioned = new Set(
    pinned.flatMap((f) => (f.kind === "builtin" ? [f.name] : []))
  );
  const tail = kDefaultFields.filter(
    (f) => f.kind === "builtin" && !mentioned.has(f.name)
  );
  return [...pinned, ...tail];
};

describe("resolveScannerResultView", () => {
  it("resolves hostile wildcard patterns without blocking the viewer", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        ["*a".repeat(24)]: { fields: [builtin("value")], exclude_fields: [] },
      },
    };
    expect(resolveScannerResultView(viewer, "a".repeat(40) + "b")).toEqual(
      kDefaultResolvedView
    );
  });

  it.each([
    ["audit_?", "audit_a", true],
    ["audit_?", "audit_ab", false],
    ["audit_[a-c]", "audit_b", true],
    ["audit_[a-c]", "audit_z", false],
    ["audit_[!a-c]", "audit_z", false],
    ["audit_[^a-c]", "audit_b", false],
    ["audit_[]a]", "audit_]", true],
    ["audit_[a-]", "audit_-", true],
    ["audit_[\\]]", "audit_]", true],
    ["[ab]", "[ab]", true],
    ["*", "", false],
    ["?", "", false],
    ["audit_[z-a]", "audit_a", false],
    ["audit_[ab", "audit_[ab", true],
    ["audit_\\*", "audit_*", true],
    ["audit_\\*", "audit_other", false],
    ["audit_\\?", "audit_?", true],
    ["audit_\\[x]", "audit_[x]", true],
    ["audit_[a\\-c]", "audit_b", false],
    ["audit_[a\\-c]", "audit_-", true],
    ["audit_\\", "audit_\\", true],
    ["audit_?", "audit_😀", false],
    ["audit_??", "audit_😀", true],
    ["*", ".hidden", false],
    ["*", "package/scanner", false],
    ["audit_**", "audit_nested/scanner", false],
    ["audit_(a|b)", "audit_(a|b)", true],
    ["audit_(a|b)", "audit_a", false],
    ["audit_{a,b}", "audit_{a,b}", true],
    ["!audit", "!audit", true],
  ])("matches pattern %s against %s: %s", (pattern, scannerName, matches) => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        [pattern]: { fields: [builtin("value")], exclude_fields: [] },
      },
    };
    expect(resolveScannerResultView(viewer, scannerName).fields).toEqual(
      matches ? withAppendedDefaults([builtin("value")]) : kDefaultFields
    );
  });

  it("preserves picomatch display rules for ordinary scanner names and paths", () => {
    for (const { pattern, matchingNames } of scannerGlobCompatibility.cases) {
      const viewer: ViewerConfig = {
        scanner_result_view: {
          [pattern]: {
            fields: [builtin("value")],
            exclude_fields: [builtin("answer"), meta("internal")],
          },
        },
      };
      for (const name of scannerGlobCompatibility.names) {
        const matches = matchingNames.includes(name);
        const resolved = resolveScannerResultView(viewer, name);
        expect(resolved, `${pattern} against ${name}`).toEqual(
          matches
            ? {
                fields: withAppendedDefaults([builtin("value")]).filter(
                  (field) => field.kind !== "builtin" || field.name !== "answer"
                ),
                excludedMetadataKeys: ["internal"],
              }
            : kDefaultResolvedView
        );
      }
    }
  });

  it.each(["package/scanner", ".hidden", "package/.hidden"])(
    "keeps bare display rules from hiding fields for %s",
    (name) => {
      expect(
        resolveScannerResultView(
          {
            scanner_result_view: {
              fields: [builtin("value")],
              exclude_fields: [builtin("answer")],
            },
          },
          name
        )
      ).toEqual(kDefaultResolvedView);
    }
  );

  it("rejects empty patterns", () => {
    expect(() =>
      resolveScannerResultView(
        {
          scanner_result_view: { "": { fields: null, exclude_fields: [] } },
        },
        "scanner"
      )
    ).toThrow("glob patterns must not be empty");
  });

  it("bounds work across multiple globstar segments", () => {
    expect(() =>
      resolveScannerResultView(
        {
          scanner_result_view: {
            ["**/a/".repeat(800) + "b"]: { fields: null, exclude_fields: [] },
          },
        },
        "a/".repeat(2047) + "c"
      )
    ).toThrow("glob matching work limit");
  });

  it("handles hundreds of hostile patterns while preserving the matching view", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: Object.fromEntries<ScannerResultView>([
        ...Array.from(
          { length: 512 },
          (_, index): [string, ScannerResultView] => [
            "*a".repeat(24) + index,
            { fields: [builtin("answer")], exclude_fields: [] },
          ]
        ),
        ["*", { fields: [builtin("value")], exclude_fields: [] }],
      ]),
    };
    expect(
      resolveScannerResultView(viewer, "a".repeat(60) + "b").fields
    ).toEqual(withAppendedDefaults([builtin("value")]));
  });

  it("rejects excessive pattern counts instead of applying a partial configuration", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: Object.fromEntries<ScannerResultView>(
        Array.from(
          { length: 1025 },
          (_, index): [string, ScannerResultView] => [
            `scanner_${index}`,
            { fields: null, exclude_fields: [] },
          ]
        )
      ),
    };
    expect(() => resolveScannerResultView(viewer, "scanner_0")).toThrow(
      "at most 1024 glob patterns"
    );
  });

  it.each([
    ["a".repeat(4097), "a"],
    ["*", "a".repeat(4097)],
  ])(
    "rejects excessive pattern or scanner-name lengths",
    (pattern, scannerName) => {
      const viewer: ViewerConfig = {
        scanner_result_view: {
          [pattern]: { fields: null, exclude_fields: [] },
        },
      };
      expect(() => resolveScannerResultView(viewer, scannerName)).toThrow(
        "at most 4096 characters"
      );
    }
  );

  it("bounds quadratic wildcard rescanning", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        ["*" + "a".repeat(2048) + "b"]: { fields: null, exclude_fields: [] },
      },
    };
    expect(() => resolveScannerResultView(viewer, "a".repeat(4096))).toThrow(
      "glob matching work limit"
    );
  });

  it("shares the matching work limit across the whole configuration", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: Object.fromEntries<ScannerResultView>(
        Array.from({ length: 128 }, (_, index): [string, ScannerResultView] => [
          "*" + "a".repeat(127) + index,
          { fields: null, exclude_fields: [] },
        ])
      ),
    };
    expect(() => resolveScannerResultView(viewer, "a".repeat(4096))).toThrow(
      "glob matching work limit"
    );
  });

  it("bounds repeated unclosed character classes during pattern parsing", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        ["[".repeat(4096)]: { fields: null, exclude_fields: [] },
      },
    };
    expect(() => resolveScannerResultView(viewer, "scanner")).toThrow(
      "glob matching work limit"
    );
  });

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

  it("pins the user's fields in order and appends unlisted defaults", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": {
          fields: [builtin("explanation"), builtin("value")],
          exclude_fields: [],
        },
      },
    };
    const resolved = resolveScannerResultView(viewer, "anything");
    expect(resolved.fields).toEqual(
      withAppendedDefaults([builtin("explanation"), builtin("value")])
    );
    expect(resolved.excludedMetadataKeys).toEqual([]);
  });

  it("promoted MetadataField entries render inline; remaining defaults append after", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": {
          fields: [builtin("value"), meta("summary")],
          exclude_fields: [],
        },
      },
    };
    const resolved = resolveScannerResultView(viewer, "anything");
    // User pins [value, summary], then default order minus value appends.
    expect(resolved.fields).toEqual(
      withAppendedDefaults([builtin("value"), meta("summary")])
    );
    // Promoted keys are also hidden from the default Metadata dump.
    expect(resolved.excludedMetadataKeys).toEqual(["summary"]);
  });

  it("exact name beats `*`", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": { fields: [builtin("explanation")], exclude_fields: [] },
        is_ascii: { fields: [builtin("value")], exclude_fields: [] },
      },
    };
    expect(resolveScannerResultView(viewer, "is_ascii").fields).toEqual(
      withAppendedDefaults([builtin("value")])
    );
  });

  it("prefix glob beats `*`, exact name beats prefix glob", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": { fields: [builtin("explanation")], exclude_fields: [] },
        "audit_*": { fields: [builtin("value")], exclude_fields: [] },
        audit_judge: { fields: [builtin("answer")], exclude_fields: [] },
      },
    };
    expect(resolveScannerResultView(viewer, "audit_judge").fields).toEqual(
      withAppendedDefaults([builtin("answer")])
    );
    expect(resolveScannerResultView(viewer, "audit_other").fields).toEqual(
      withAppendedDefaults([builtin("value")])
    );
    expect(resolveScannerResultView(viewer, "is_ascii").fields).toEqual(
      withAppendedDefaults([builtin("explanation")])
    );
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
    expect(resolveScannerResultView(viewer, "audit_judge").fields).toEqual(
      withAppendedDefaults([builtin("value")])
    );
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
    // `fields` pins value + metadata; unlisted defaults append (minus nothing
    // excluded at builtin level).
    expect(resolved.fields).toEqual(
      withAppendedDefaults([builtin("value"), builtin("metadata")])
    );
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
    // Everything else in default order still renders.
    expect(resolved.fields.map((f) => f.kind === "builtin" && f.name)).toEqual(
      defaultBuiltinNames.filter((n) => n !== "answer")
    );
  });

  it("`exclude_fields` can hide a section the user did NOT list (auto-appended default)", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": {
          fields: [builtin("value"), builtin("explanation")],
          exclude_fields: [builtin("metadata")],
        },
      },
    };
    const resolved = resolveScannerResultView(viewer, "any");
    expect(
      resolved.fields.map((f) => (f.kind === "builtin" ? f.name : f.key))
    ).not.toContain("metadata");
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
    // `answer` is excluded, so the appended-default tail drops it.
    const pinned = [builtin("explanation"), meta("summary"), builtin("value")];
    const mentioned = new Set(["explanation", "value"]);
    const tail = kDefaultFields.filter(
      (f) =>
        f.kind === "builtin" && !mentioned.has(f.name) && f.name !== "answer"
    );
    expect(resolved.fields).toEqual([...pinned, ...tail]);
    expect(new Set(resolved.excludedMetadataKeys)).toEqual(
      new Set(["summary", "_internal"])
    );
  });

  it("drops entries with unknown kind or invalid builtin names", () => {
    // Intentionally malformed entry — runtime validation must drop it.
    const bogus: { kind: string; name: string } = {
      kind: "bogus",
      name: "value",
    };
    const viewer: ViewerConfig = {
      scanner_result_view: {
        "*": {
          fields: [
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- deliberately out of contract: this case exists to prove runtime validation drops an entry no valid ScannerResultField could be
            bogus as ScannerResultField,
            builtin("value"),
            "not_a_real_builtin",
          ],
          exclude_fields: [],
        },
      },
    };
    const resolved = resolveScannerResultView(viewer, "any");
    // Only the valid `builtin("value")` survives as user-pinned; defaults append.
    expect(resolved.fields).toEqual(withAppendedDefaults([builtin("value")]));
  });

  it("accepts a bare ScannerResultView as the scanner_result_view shorthand", () => {
    const viewer: ViewerConfig = {
      scanner_result_view: {
        fields: [builtin("value"), builtin("explanation")],
        exclude_fields: [],
      },
    };
    const resolved = resolveScannerResultView(viewer, "any");
    expect(resolved.fields).toEqual(
      withAppendedDefaults([builtin("value"), builtin("explanation")])
    );
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
      defaultBuiltinNames.filter((n) => n !== "answer")
    );
  });
});
