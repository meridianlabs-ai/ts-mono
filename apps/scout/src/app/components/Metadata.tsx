import { FC } from "react";

import { RecordTree } from "@tsmono/inspect-components/content";
import {
  LabeledValue,
  MarkdownDivWithReferences,
  MarkdownReference,
} from "@tsmono/react/components";

import { JsonValue } from "../../types/json-value";

import styles from "./Metadata.module.css";

interface MetadataProps {
  metadata: Record<string, JsonValue>;
  references?: MarkdownReference[];
  options?: {
    previewRefsOnHover?: boolean;
  };
}

export const Metadata: FC<MetadataProps> = ({
  metadata,
  references,
  options,
}) => {
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return null;
  }

  return (
    <>
      {entries.map(([key, value]) => (
        <LabeledValue key={key} label={key} className={styles.entry}>
          <MetadataValue
            id={key}
            value={value}
            references={references}
            options={options}
          />
        </LabeledValue>
      ))}
    </>
  );
};

interface MetadataValueProps {
  id: string;
  value: JsonValue;
  references?: MarkdownReference[];
  options?: {
    previewRefsOnHover?: boolean;
  };
}

const MetadataValue: FC<MetadataValueProps> = ({
  id,
  value,
  references,
  options,
}) => {
  if (typeof value === "string") {
    return (
      <MarkdownDivWithReferences
        markdown={value}
        references={references}
        options={options}
      />
    );
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return (
      <RecordTree
        id={`metadata-${id}`}
        record={value as Record<string, unknown>}
        useBorders={false}
      />
    );
  }

  if (Array.isArray(value)) {
    // Convert array to record with index keys for RecordTree
    const record: Record<string, unknown> = {};
    value.forEach((item, i) => {
      record[`[${i}]`] = item;
    });
    return (
      <RecordTree id={`metadata-${id}`} record={record} useBorders={false} />
    );
  }

  // Primitives: number, boolean, null
  if (value === null) {
    return <code>null</code>;
  }
  return <span>{String(value)}</span>;
};
