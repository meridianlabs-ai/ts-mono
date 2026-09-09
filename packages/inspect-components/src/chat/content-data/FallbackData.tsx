import clsx from "clsx";
import { FC } from "react";

import { isRecord } from "@tsmono/util";

export const kFallbackMetadata = "fallback_metadata";

const modelName = (side: unknown): string => {
  if (!isRecord(side)) return "unknown";
  const model = side["model"];
  return typeof model === "string" ? model : "unknown";
};

/**
 * Marks a server-side model fallback handoff: the requested model's
 * safety classifiers refused and a fallback model served the request.
 */
export const FallbackData: FC<{
  data: Record<string, unknown>;
}> = ({ data }) => {
  const fallback = data[kFallbackMetadata];
  const from = modelName(isRecord(fallback) ? fallback["from"] : undefined);
  const to = modelName(isRecord(fallback) ? fallback["to"] : undefined);

  return (
    <div className={clsx("text-size-small")}>
      <div className={clsx("text-style-label", "text-style-secondary")}>
        Model Fallback
      </div>
      <div>{`${from} → ${to}`}</div>
    </div>
  );
};
