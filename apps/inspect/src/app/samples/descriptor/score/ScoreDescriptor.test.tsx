// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ComponentIconProvider,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, testIcons } from "@tsmono/react/testing";

import { ScoreValue } from "../../../../@types/extraInspect";
import {
  kScoreTypeList,
  kScoreTypeNumeric,
  kScoreTypeObject,
  kScoreTypeOther,
} from "../../../../constants";

import { getScoreDescriptorForValues } from "./ScoreDescriptor";

afterEach(cleanup);

const mixedColumns: { name: string; values: ScoreValue[]; text: string[] }[] = [
  {
    name: "list and string",
    values: [[2, 3], "refused"],
    text: ["2", "3", "refused"],
  },
  {
    name: "object and string",
    values: [{ points: 7 }, "refused"],
    text: ["points", "7", "refused"],
  },
  {
    name: "list and object",
    values: [[2, 3], { points: 7 }],
    text: ["2", "3", "points", "7"],
  },
  {
    name: "number and string",
    values: [42, "refused"],
    text: ["42", "refused"],
  },
  { name: "number and list", values: [42, [2, 3]], text: ["42", "2", "3"] },
  {
    name: "object and boolean",
    values: [{ points: 7 }, true],
    text: ["points", "7", "true"],
  },
];

describe("mixed score columns", () => {
  it.each(mixedColumns)(
    "renders every $name value in either order",
    ({ values, text }) => {
      for (const orderedValues of [values, values.toReversed()]) {
        const descriptor = getScoreDescriptorForValues(orderedValues, [
          ...new Set(orderedValues.map((value) => typeof value)),
        ]);
        expect(descriptor).toBeDefined();
        if (!descriptor) throw new Error("Missing score descriptor");

        const { container, unmount } = render(
          <ComponentStateProvider hooks={makeStateHooks()}>
            <ComponentIconProvider icons={testIcons}>
              <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
                {orderedValues.map((value, index) => (
                  <div key={index}>{descriptor.render(value)}</div>
                ))}
              </ComponentNavigationProvider>
            </ComponentIconProvider>
          </ComponentStateProvider>
        );
        for (const value of text) {
          expect(container).toHaveTextContent(value);
        }
        expect(descriptor.scoreType).toBe(kScoreTypeOther);
        unmount();
      }
    }
  );
});

describe("homogeneous score columns", () => {
  const columns: { values: ScoreValue[]; scoreType: string }[] = [
    { values: [[2, 3], [4]], scoreType: kScoreTypeList },
    { values: [{ points: 7 }, { points: 8 }], scoreType: kScoreTypeObject },
    { values: [2, 3], scoreType: kScoreTypeNumeric },
  ];

  it.each(columns)(
    "retains the $scoreType renderer",
    ({ values, scoreType }) => {
      const descriptor = getScoreDescriptorForValues(values, [
        ...new Set(values.map((value) => typeof value)),
      ]);
      expect(descriptor?.scoreType).toBe(scoreType);
    }
  );
});
