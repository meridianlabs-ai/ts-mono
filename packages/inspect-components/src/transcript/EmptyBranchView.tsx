import clsx from "clsx";
import { FC } from "react";

import type { SpanBeginEvent } from "@tsmono/inspect-common/types";
import { isRecord } from "@tsmono/util";

import styles from "./EmptyBranchView.module.css";
import type { EmptyBranchData } from "./timeline/timelineEventNodes";
import { EventNode } from "./types";

/** Shallow: the note below renders branchName and terminator. */
const isEmptyBranchData = (value: unknown): value is EmptyBranchData =>
  isRecord(value) && typeof value["branchName"] === "string";

interface EmptyBranchViewProps {
  eventNode: EventNode<SpanBeginEvent>;
  className?: string;
}

export const EmptyBranchView: FC<EmptyBranchViewProps> = ({
  eventNode,
  className,
}) => {
  const metadata: unknown = eventNode.event.metadata;
  const data = isRecord(metadata) ? metadata["empty_branch"] : undefined;
  if (!isEmptyBranchData(data)) return null;

  return (
    <div className={clsx(styles.empty, className)} role="note">
      <div className={styles.headline}>No events in this branch</div>
      {data.terminator ? (
        <div className={styles.detail}>
          Branch ended via <code>{data.terminator}</code>
        </div>
      ) : null}
    </div>
  );
};
