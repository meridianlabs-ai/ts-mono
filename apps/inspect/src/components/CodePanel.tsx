import clsx from "clsx";
import { FC, useRef } from "react";

import { ContentCode } from "@tsmono/react/components";
import { usePrismHighlight } from "@tsmono/react/hooks";

import styles from "./CodePanel.module.css";

interface CodePanelProps {
  code: string;
  language?: string;
}

export const CodePanel: FC<CodePanelProps> = ({ code, language = "json" }) => {
  // Syntax highlighting
  const codeContainerRef = useRef<HTMLDivElement>(null);
  usePrismHighlight(codeContainerRef, code.length);
  return (
    <div ref={codeContainerRef} className={clsx(styles.panel)}>
      <pre className={clsx(styles.code)}>
        <ContentCode className={clsx(`language-${language}`)} text={code} />
      </pre>
    </div>
  );
};
