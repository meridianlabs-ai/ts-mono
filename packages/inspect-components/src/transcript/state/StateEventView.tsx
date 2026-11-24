import clsx from "clsx";
import { FC, ReactNode, useEffect, useMemo } from "react";

import type {
  JsonChange,
  StateEvent,
  StoreEvent,
} from "@tsmono/inspect-common/types";
import { formatDateTime } from "@tsmono/util";

import { EventPanel } from "../event/EventPanel";
import { EventNode, EventPanelCallbacks } from "../types";

import { StateDiffView } from "./StateDiffView";
import {
  matchesChangeSignature,
  RenderableChangeTypes,
  StoreSpecificRenderableTypes,
} from "./StateEventRenderers";
import styles from "./StateEventView.module.css";

interface StateEventViewProps {
  eventNode: EventNode<StateEvent | StoreEvent>;
  isStore?: boolean;
  className?: string;
  onAutoCollapse?: (eventId: string) => void;
  eventCallbacks?: EventPanelCallbacks;
}

type JsonChangeOp = JsonChange["op"];
/**
 * Renders the StateEventView component.
 */
export const StateEventView: FC<StateEventViewProps> = ({
  eventNode,
  className,
  onAutoCollapse,
  eventCallbacks,
}) => {
  const event = eventNode.event;

  const summary = useMemo(() => {
    return summarizeChanges(event.changes);
  }, [event.changes]);

  const changePreview = useMemo(() => {
    const isStore = eventNode.event.event === "store";
    return generatePreview(event.changes, isStore, eventNode.id);
  }, [event.changes, eventNode.event.event, eventNode.id]);
  // Compute the title
  const title = event.event === "state" ? "State Updated" : "Store Updated";

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (changePreview === undefined && onAutoCollapse) {
      onAutoCollapse(eventNode.id);
    }
  }, [changePreview, onAutoCollapse, eventNode.id]);

  return (
    <EventPanel
      eventNodeId={eventNode.id}
      title={title}
      className={className}
      subTitle={
        event.timestamp ? formatDateTime(new Date(event.timestamp)) : undefined
      }
      text={!changePreview ? summary : undefined}
      collapsibleContent={true}
      eventCallbacks={eventCallbacks}
    >
      {changePreview ? (
        <div data-name="Summary" className={clsx(styles.summary)}>
          {changePreview}
        </div>
      ) : undefined}
      <StateDiffView
        changes={event.changes}
        data-name="Diff"
        className={clsx(styles.diff)}
      />
    </EventPanel>
  );
};

/**
 * Renders the value of a change based on its type.
 */
const generatePreview = (
  changes: JsonChange[],
  isStore: boolean,
  eventNodeId: string
) => {
  const results: ReactNode[] = [];
  for (const changeType of [
    ...RenderableChangeTypes,
    ...(isStore ? StoreSpecificRenderableTypes : []),
  ]) {
    if (changeType.signature) {
      if (matchesChangeSignature(changes, changeType.signature)) {
        const el = changeType.render(changes, eventNodeId);
        results.push(el);
        break;
      }
    } else if (changeType.match) {
      const matches = changeType.match(changes);
      if (matches) {
        const el = changeType.render(changes, eventNodeId);
        results.push(el);
        break;
      }
    }
  }
  return results.length > 0 ? results : undefined;
};

/**
 * Renders the value of a change based on its type.
 */
const summarizeChanges = (changes: JsonChange[]): string => {
  const changeMap: Record<JsonChangeOp, string[]> = {
    add: [],
    copy: [],
    move: [],
    replace: [],
    remove: [],
    test: [],
  };
  for (const change of changes) {
    switch (change.op) {
      case "add":
        changeMap.add.push(change.path);
        break;
      case "copy":
        changeMap.copy.push(change.path);
        break;
      case "move":
        changeMap.move.push(change.path);
        break;
      case "replace":
        changeMap.replace.push(change.path);
        break;
      case "remove":
        changeMap.remove.push(change.path);
        break;
      case "test":
        changeMap.test.push(change.path);
        break;
    }
  }

  const changeList: string[] = [];
  const totalOpCount = Object.values(changeMap).reduce(
    (prev, opChanges) => prev + opChanges.length,
    0
  );

  if (totalOpCount > 2) {
    Object.entries(changeMap).forEach(([key, opChanges]) => {
      if (opChanges.length > 0) {
        changeList.push(`${key} ${opChanges.length}`);
      }
    });
  } else {
    Object.entries(changeMap).forEach(([key, opChanges]) => {
      if (opChanges.length > 0) {
        changeList.push(`${key} ${opChanges.join(", ")}`);
      }
    });
  }
  return changeList.join(", ");
};
