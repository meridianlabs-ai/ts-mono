import clsx from "clsx";
import { CSSProperties, FC, useMemo, useRef } from "react";

import { usePrismHighlight } from "../hooks/usePrismHighlight";

import { ContentCode } from "./ContentTrust";
import styles from "./JsonPanel.module.css";
import { jsonPanelText } from "./jsonPanelText";

interface JSONPanelProps {
  id?: string;
  data?: unknown;
  json?: string;
  simple?: boolean;
  style?: CSSProperties;
  className?: string | string[];
}

export const JSONPanel: FC<JSONPanelProps> = ({
  id,
  json,
  data,
  simple = false,
  style,
  className,
}) => {
  const sourceCode = useMemo(() => {
    if (json) return json;
    if (data) return jsonPanelText(data);
    return "";
  }, [json, data]);

  const sourceCodeRef = useRef<HTMLDivElement | null>(null);
  usePrismHighlight(sourceCodeRef, sourceCode.length);

  return (
    <div ref={sourceCodeRef}>
      <pre
        className={clsx(
          styles.jsonPanel,
          simple ? styles.simple : "",
          className
        )}
        style={style}
      >
        <ContentCode
          id={id}
          className={clsx("source-code", "language-javascript")}
          text={sourceCode}
        />
      </pre>
    </div>
  );
};

export default JSONPanel;
