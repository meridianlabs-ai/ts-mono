// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { testModelEvent } from "@tsmono/inspect-common/testing";
import { isRecord } from "@tsmono/util";

import { eventNode } from "../testHelpers";
import { flatTree } from "../transform/flatten";
import { EventNode } from "../types";

import {
  buildOutlineNodeList,
  resolveOutlineSelection,
} from "./useOutlineNodes";

// Three model turns collapse into one "3 turns" outline row whose id is the
// first turn's id (collapseTurns reuses it), so the 2nd/3rd turns' ids match
// no outline row by identity.
function threeTurnGroup() {
  const model1 = eventNode(testModelEvent());
  const model2 = eventNode(testModelEvent());
  const model3 = eventNode(testModelEvent());
  const eventNodes = [model1, model2, model3];

  const outlineNodeList = buildOutlineNodeList(eventNodes, {});
  const allNodesList = flatTree(eventNodes, null);

  return { model1, model2, model3, outlineNodeList, allNodesList };
}

// The outline's collapsed rows carry a rewritten `name`; read it without
// claiming every member of the event union has one.
const readStringField = (node: EventNode, key: string): string | undefined => {
  const event: unknown = node.event;
  if (!isRecord(event)) return undefined;
  const value = event[key];
  return typeof value === "string" ? value : undefined;
};

describe("resolveOutlineSelection", () => {
  it("fixture collapses to a single '3 turns' row keyed on the first turn", () => {
    const { model1, outlineNodeList } = threeTurnGroup();
    expect(outlineNodeList).toHaveLength(1);
    expect(outlineNodeList[0]!.event.event).toBe("span_begin");
    expect(readStringField(outlineNodeList[0]!, "name")).toBe("3 turns");
    expect(outlineNodeList[0]!.id).toBe(model1.id);
  });

  it("maps a mid-group turn selection to the enclosing 'N turns' row", () => {
    const { model1, model2, model3, outlineNodeList, allNodesList } =
      threeTurnGroup();
    const rowId = outlineNodeList[0]!.id;

    expect(
      resolveOutlineSelection(model1.id, allNodesList, outlineNodeList)
    ).toBe(rowId);
    expect(
      resolveOutlineSelection(model2.id, allNodesList, outlineNodeList)
    ).toBe(rowId);
    expect(
      resolveOutlineSelection(model3.id, allNodesList, outlineNodeList)
    ).toBe(rowId);
  });

  it("is order-independent across racing writers (last write still bolds the row)", () => {
    const { model1, model3, outlineNodeList, allNodesList } = threeTurnGroup();
    const rowId = outlineNodeList[0]!.id;

    const first = resolveOutlineSelection(
      model1.id,
      allNodesList,
      outlineNodeList
    );
    const second = resolveOutlineSelection(
      model3.id,
      allNodesList,
      outlineNodeList
    );
    expect(first).toBe(rowId);
    expect(second).toBe(rowId);
  });

  it("returns null for no selection or an unknown id (first-row default preserved)", () => {
    const { outlineNodeList, allNodesList } = threeTurnGroup();
    expect(
      resolveOutlineSelection(null, allNodesList, outlineNodeList)
    ).toBeNull();
    expect(
      resolveOutlineSelection(undefined, allNodesList, outlineNodeList)
    ).toBeNull();
    expect(
      resolveOutlineSelection("nonexistent", allNodesList, outlineNodeList)
    ).toBeNull();
  });
});
