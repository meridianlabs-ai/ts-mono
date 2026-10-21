import clsx from "clsx";
import { FC, ReactNode } from "react";

import type { Content } from "@tsmono/inspect-common/types";
import {
  ANSIDisplay,
  ChunkedText,
  RequireMedia,
  usePlainText,
} from "@tsmono/react/components";
import {
  isAnsiOutput,
  isRenderableImageSource,
  parseJsonRecord,
  stripAnsi,
} from "@tsmono/util";

import { CappedText, kMaxInlineChars } from "../../content/cappedText";
import { useDisplayMode } from "../../content/DisplayModeContext";
import { MediaReference } from "../../media/MediaReference";
import { ContentDocumentView } from "../documents/ContentDocumentView";
import { JsonMessageContent } from "../JsonMessageContent";

import styles from "./ToolOutput.module.css";

interface ToolOutputProps {
  output: string | number | boolean | Exclude<Content, { type: "tool_use" }>[];
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
      } else if (out.type === "image") {
        if (isRenderableImageSource(out.image)) {
          outputs.push(
            <RequireMedia kind="image" key={key}>
              <img
                className={clsx(styles.toolImage)}
                src={out.image}
                alt="Tool output"
              />
            </RequireMedia>
          );
        } else {
          outputs.push(<MediaReference source={out.image} key={key} />);
        }
      } else if (out.type === "reasoning") {
        if (out.reasoning) {
          outputs.push(<ToolTextOutput text={out.reasoning} key={key} />);
        }
      } else if (out.type === "data") {
        outputs.push(
          <ToolTextOutput text={JSON.stringify(out.data)} key={key} />
        );
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
  const displayMode = useDisplayMode();
  const plain = usePlainText();

  if (displayMode === "rendered") {
    const obj = parseJsonRecord(text);
    if (obj) {
      return <JsonMessageContent id={`1-json`} json={obj} />;
    }
  }

  // It could have ANSI codes. Colors render only for the head, so only the
  // head is checked.
  const ansi =
    displayMode === "rendered" && isAnsiOutput(text.slice(0, kMaxInlineChars));

  // As the head shows it: trimmed, unless raw or untrusted.
  const trim = plain.trusted && displayMode !== "raw";
  const renderPlain = (shown: string) => (
    <pre className={clsx(styles.textOutput, "tool-output", plain.className)}>
      <code className={clsx("sourceCode", styles.textCode)}>
        <ChunkedText text={shown} />
      </code>
    </pre>
  );

  return (
    <CappedText
      text={text}
      // Escapes can start past the head, so the full text is always stripped
      // when rendered. Only its start is trimmed: where the hidden text starts
      // is measured on the head's length.
      toPlainText={(all) => {
        const shown = displayMode === "rendered" ? stripAnsi(all) : all;
        return trim ? shown.trimStart() : shown;
      }}
      render={(shown) =>
        ansi ? (
          <ANSIDisplay
            output={shown}
            style={{ fontSize: "clamp(0.4rem, 1.15vw, 0.9rem)" }}
          />
        ) : (
          renderPlain(trim ? shown.trim() : plain.present(shown))
        )
      }
      renderPlain={renderPlain}
    />
  );
};
