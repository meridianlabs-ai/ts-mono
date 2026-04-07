import { FC, ReactNode } from "react";

import { SourceCodePanel } from "@tsmono/react/components";

import type { ToolCallViewProps } from "./ToolCallView";

/**
 * Default custom tool views built into the shared package.
 * Apps can provide additional custom views via the getCustomToolView prop.
 */
export const getDefaultCustomToolView = (
  props: ToolCallViewProps
): ReactNode | undefined => {
  if (props.tool === "answer") {
    return <AnswerToolCallView {...props} />;
  }
  return undefined;
};

const AnswerToolCallView: FC<ToolCallViewProps> = (props) => {
  return (
    <SourceCodePanel
      code={props.functionCall}
      language="python"
      id={props.id}
    />
  );
};
