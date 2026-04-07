import clsx from "clsx";
import { FC, ReactNode } from "react";

import type {
  ContentDocument,
  ContentImage,
  ContentText,
} from "@tsmono/inspect-common/types";
import { ANSIDisplay } from "@tsmono/react/components";
import { isAnsiOutput, isJson } from "@tsmono/util";

import { ContentDocumentView } from "../documents/ContentDocumentView";
import { JsonMessageContent } from "../JsonMessageContent";

import styles from "./ToolOutput.module.css";

interface ToolOutputProps {
  output:
    | string
    | number
    | boolean
    | (ContentText | ContentImage | ContentDocument)[];
  className?: string | string[];
  onDownloadFile?: (filename: string, document: string) => void;
}

/**
 * Renders the ToolOutput component.
 */
export const ToolOutput: FC<ToolOutputProps> = ({
  output,
  className,
  onDownloadFile,
}) => {
  // If there is no output, don't show the tool
  if (!output) {
    return null;
  }

  // First process an array or object into a string
  const outputs: ReactNode[] = [];
  if (Array.isArray(output)) {
    output.forEach((out, idx) => {
      const key = `tool-output-${idx}`;
      if (out.type === "text") {
        outputs.push(<ToolTextOutput text={out.text} key={key} />);
      } else if (out.type === "document") {
        outputs.push(
          <ContentDocumentView
            id={key}
            document={out}
            key={key}
            onDownloadFile={onDownloadFile}
          />
        );
      } else {
        if (out.image.startsWith("data:")) {
          outputs.push(
            <img className={clsx(styles.toolImage)} src={out.image} key={key} />
          );
        } else {
          outputs.push(<ToolTextOutput text={String(out.image)} key={key} />);
        }
      }
    });
  } else {
    outputs.push(
      <ToolTextOutput text={String(output)} key={"tool-output-single"} />
    );
  }
  return <div className={clsx(styles.output, className)}>{outputs}</div>;
};

interface ToolTextOutputProps {
  text: string;
}

/**
 * Renders the ToolTextOutput component.
 */
const ToolTextOutput: FC<ToolTextOutputProps> = ({ text }) => {
  if (isJson(text)) {
    const obj = JSON.parse(text);
    return <JsonMessageContent id={`1-json`} json={obj} />;
  }

  // It could have ANSI codes
  if (isAnsiOutput(text)) {
    return (
      <ANSIDisplay
        className={styles.ansiOutput}
        output={text}
        style={{ fontSize: "clamp(0.4rem, 1.15vw, 0.9rem)" }}
      />
    );
  }

  return (
    <pre className={clsx(styles.textOutput, "tool-output")}>
      <code className={clsx("sourceCode", styles.textCode)}>{text.trim()}</code>
    </pre>
  );
};
