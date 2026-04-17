import clsx from "clsx";
import { FC, ReactNode } from "react";

import { MarkdownReference } from "@tsmono/react/components";

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
  const valueStacked =
    data.valueType === "object" || data.valueType === "array";

  const valueNode = (
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
  );

  const validationNode = hasValidation ? (
    <div className={clsx(styles.validation)}>
      <div
        className={clsx(
          "text-style-label",
          "text-style-secondary",
          styles.validationLabel,
        )}
      >
        Validation
      </div>
      <ValidationResult
        result={data.validationResult!}
        target={data.validationTarget}
        label={data.label}
      />
    </div>
  ) : null;

  return (
    <div className={clsx(styles.container, "text-size-small")}>
      {header ? <div className={styles.header}>{header}</div> : null}

      {data.label ? (
        <>
          <div className={clsx("text-style-label", "text-style-secondary")}>
            Label
          </div>
          <div>{data.label}</div>
        </>
      ) : null}

      {valueStacked ? (
        <div className={clsx(styles.colspan)}>
          <div className={clsx("text-style-label", "text-style-secondary")}>
            Value
          </div>
          <div className={clsx(hasValidation ? styles.values : undefined)}>
            {valueNode}
            {validationNode}
          </div>
        </div>
      ) : (
        <>
          <div className={clsx("text-style-label", "text-style-secondary")}>
            Value
          </div>
          <div className={clsx(hasValidation ? styles.values : undefined)}>
            {valueNode}
            {validationNode}
          </div>
        </>
      )}

      {data.answer ? (
        <>
          <div className={clsx("text-style-label", "text-style-secondary")}>
            Answer
          </div>
          <div>{data.answer}</div>
        </>
      ) : null}

      {data.explanation ? (
        <div className={clsx(styles.colspan)}>
          <div className={clsx("text-style-label", "text-style-secondary")}>
            Explanation
          </div>
          <Explanation
            explanation={data.explanation}
            references={references}
            options={options}
          />
        </div>
      ) : null}

      {hasMetadata ? (
        <div className={clsx(styles.colspan)}>
          <div
            className={clsx("text-style-label", "text-style-secondary")}
          ></div>
          <Metadata
            metadata={data.metadata!}
            references={references}
            options={options}
          />
        </div>
      ) : null}
    </div>
  );
};
