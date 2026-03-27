import { FC } from "react";

import { SourceCodePanel } from "@tsmono/react/components";

import { ToolCallViewProps } from "./ToolCallView";

export const getCustomToolView = (props: ToolCallViewProps) => {
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
