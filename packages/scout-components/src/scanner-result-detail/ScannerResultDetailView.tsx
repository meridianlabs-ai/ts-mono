import { VscodeCollapsible } from "@vscode-elements/react-elements";
import clsx from "clsx";
import { FC, ReactNode, useCallback } from "react";

import { MarkdownReference } from "@tsmono/react/components";
import { useCollapsibleIds } from "@tsmono/react/hooks";

import { Explanation } from "./Explanation";
import { Metadata } from "./Metadata";
import styles from "./ScannerResultDetailView.module.css";
import { ScanResultInput } from "./types";
import { ValidationResult } from "./ValidationResult";
import { Value } from "./Value";

interface ScannerResultDetailViewProps {
  data: ScanResultInput;
  references?: MarkdownReference[];
  header?: ReactNode;
  interactive?: boolean;
  options?: {
    previewRefsOnHover?: boolean;
  };
}

type SectionId =
  | "label"
  | "value"
  | "validation"
  | "answer"
  | "explanation"
  | "metadata";

const kCollapseScope = "scanner-result-sections";

interface SectionProps {
  id: SectionId;
  heading: string;
  open: boolean;
  onToggle: (id: SectionId, open: boolean) => void;
  children: ReactNode;
}

const Section: FC<SectionProps> = ({
  id,
  heading,
  open,
  onToggle,
  children,
}) => {
  const attachToggleListener = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<{ open: boolean }>).detail;
        onToggle(id, detail.open);
      };
      el.addEventListener("vsc-collapsible-toggle", handler);
      return () => el.removeEventListener("vsc-collapsible-toggle", handler);
    },
    [id, onToggle]
  );

  return (
    <VscodeCollapsible
      ref={attachToggleListener}
      heading={heading}
      open={open}
      className={styles.section}
    >
      {children}
    </VscodeCollapsible>
  );
};

export const ScannerResultDetailView: FC<ScannerResultDetailViewProps> = ({
  data,
  references,
  header,
  interactive = false,
  options,
}) => {
  const hasValidation =
    data.validationResult !== undefined && data.validationResult !== null;
  const hasMetadata =
    data.metadata !== undefined && Object.keys(data.metadata).length > 0;

  const [collapsedIds, setCollapsed] = useCollapsibleIds(kCollapseScope);
  const isOpen = (id: SectionId) => !collapsedIds[id];

  return (
    <div className={clsx(styles.container, "text-size-small")}>
      {header ? <div className={styles.header}>{header}</div> : null}

      {data.label ? (
        <Section
          id="label"
          heading="Label"
          open={isOpen("label")}
          onToggle={setCollapsedFromOpen(setCollapsed)}
        >
          <div>{data.label}</div>
        </Section>
      ) : null}

      <Section
        id="value"
        heading="Value"
        open={isOpen("value")}
        onToggle={setCollapsedFromOpen(setCollapsed)}
      >
        <Value
          value={data.value}
          valueType={data.valueType}
          identifier={data.identifier}
          style="block"
          maxTableSize={1000}
          interactive={interactive}
          references={references}
          options={options}
        />
      </Section>

      {hasValidation ? (
        <Section
          id="validation"
          heading="Validation"
          open={isOpen("validation")}
          onToggle={setCollapsedFromOpen(setCollapsed)}
        >
          <ValidationResult
            result={data.validationResult!}
            target={data.validationTarget}
            label={data.label}
          />
        </Section>
      ) : null}

      {data.answer ? (
        <Section
          id="answer"
          heading="Answer"
          open={isOpen("answer")}
          onToggle={setCollapsedFromOpen(setCollapsed)}
        >
          <div>{data.answer}</div>
        </Section>
      ) : null}

      {data.explanation ? (
        <Section
          id="explanation"
          heading="Explanation"
          open={isOpen("explanation")}
          onToggle={setCollapsedFromOpen(setCollapsed)}
        >
          <Explanation
            explanation={data.explanation}
            references={references}
            options={options}
          />
        </Section>
      ) : null}

      {hasMetadata ? (
        <Section
          id="metadata"
          heading="Metadata"
          open={isOpen("metadata")}
          onToggle={setCollapsedFromOpen(setCollapsed)}
        >
          <Metadata
            metadata={data.metadata!}
            references={references}
            options={options}
          />
        </Section>
      ) : null}
    </div>
  );
};

// Adapts useCollapsibleIds' (id, collapsed) setter to the Section's
// (id, open) callback — collapsed is the negation of open.
const setCollapsedFromOpen =
  (setCollapsed: (id: string, collapsed: boolean) => void) =>
  (id: SectionId, open: boolean) =>
    setCollapsed(id, !open);
