import { FC, ReactNode } from "react";

import { SourceCodePanel } from "@tsmono/react/components";

import { parseToolSearchCatalog } from "./tool";
import type { ToolCallViewProps } from "./ToolCallView";
import { ToolSearchView } from "./ToolSearchView";

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
  if (props.tool === "tool_search") {
    const namespaces = parseToolSearchCatalog(props.output);
    if (namespaces) {
      return <ToolSearchView namespaces={namespaces} />;
    }
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
