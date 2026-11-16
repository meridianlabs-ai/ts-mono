import clsx from "clsx";
import JSON5 from "json5";
import { FC, Fragment, ReactNode } from "react";

import { RecordTree } from "@tsmono/inspect-components/content";
import {
  MarkdownDivWithReferences,
  MarkdownReference,
} from "@tsmono/react/components";
import {
  formatPrettyDecimal,
  isRecord,
  printArray,
  printObject,
} from "@tsmono/util";

import {
  isArrayValue,
  isBooleanValue,
  isNullValue,
  isNumberValue,
  isObjectValue,
  isStringValue,
  ValueType,
} from "./types";
import styles from "./Value.module.css";

interface ValueInput {
  value: unknown;
  valueType: ValueType;
}

interface ValueProps {
  value: unknown;
  valueType: ValueType;
  identifier?: string;
  references?: MarkdownReference[];
  style?: "inline" | "block";
  maxTableSize?: number;
  interactive?: boolean;
  options?: {
    previewRefsOnHover?: boolean;
  };
}

export const Value: FC<ValueProps> = ({
  value,
  valueType,
  identifier,
  references,
  style = "block",
  maxTableSize = 5,
  interactive = false,
  options,
}): ReactNode => {
  const input: ValueInput = { value, valueType };

  if (isStringValue(input)) {
    return (
      <MarkdownDivWithReferences
        markdown={input.value}
        references={references}
        options={options}
      />
    );
  } else if (isNumberValue(input)) {
    return formatPrettyDecimal(input.value);
  } else if (isBooleanValue(input)) {
    return (
      <div
        className={clsx(
          styles.boolean,
          input.value ? styles.true : styles.false
        )}
      >
        {String(input.value)}
      </div>
    );
  } else if (isNullValue(input)) {
    return <code>null</code>;
  } else if (isArrayValue(input)) {
    return (
      <div title={JSON5.stringify(input.value, null, 2)}>
        <ValueList
          value={input.value}
          identifier={identifier}
          references={references}
          style={style}
          maxListSize={maxTableSize}
          interactive={interactive}
        />
      </div>
    );
  } else if (isObjectValue(input)) {
    return (
      <div
        title={
          maxTableSize < Object.keys(input.value).length
            ? JSON5.stringify(input.value, null, 2)
            : undefined
        }
      >
        <ValueTable
          value={input.value}
          identifier={identifier}
          references={references}
          style={style}
          maxTableSize={maxTableSize}
          interactive={interactive}
        />
      </div>
    );
  } else {
    return "Unknown value type";
  }
};

/** The text `<Value>` renders with `interactive` off, one string per block,
 *  so Find can count matches in rows that aren't mounted. */
export const valueSearchText = (
  value: unknown,
  valueType: ValueType,
  maxTableSize = 5
): string[] => {
  const input: ValueInput = { value, valueType };
  if (isStringValue(input)) {
    return [input.value];
  } else if (isNumberValue(input)) {
    return [formatPrettyDecimal(input.value)];
  } else if (isBooleanValue(input)) {
    return [String(input.value)];
  } else if (isNullValue(input)) {
    return ["null"];
  } else if (isArrayValue(input)) {
    return input.value
      .slice(0, maxTableSize)
      .flatMap((item, index) => [`[${index}]`, cellText(item)]);
  } else if (isObjectValue(input)) {
    const record = input.value;
    const { keys, notShown } = tableKeys(record, maxTableSize);
    return [
      ...keys.flatMap((key) => [key, cellText(record[key])]),
      ...(notShown > 0 ? [`${notShown} more…`] : []),
    ];
  } else {
    return ["Unknown value type"];
  }
};

const ValueList: FC<{
  value: unknown[];
  identifier?: string;
  maxListSize: number;
  interactive: boolean;
  references?: MarkdownReference[];
  style: "inline" | "block";
}> = ({ value, identifier, maxListSize, interactive, references, style }) => {
  const itemsToDisplay = value.slice(0, maxListSize);

  return (
    <div
      className={clsx(styles.valueTable, style === "inline" && styles.inline)}
    >
      {itemsToDisplay.map((item, index) => {
        const displayValue = renderValue(
          index,
          item,
          identifier,
          references,
          interactive
        );
        return (
          <Fragment key={`value-table-row-${index}`}>
            <div
              className={clsx(
                styles.valueKey,
                "text-style-label",
                "text-style-secondary",
                "text-size-smallest"
              )}
            >
              [{index}]
            </div>
            <div className={clsx(styles.valueValue)}>{displayValue}</div>
          </Fragment>
        );
      })}
    </div>
  );
};

const ValueTable: FC<{
  value: Record<string, unknown>;
  identifier?: string;
  maxTableSize: number;
  interactive: boolean;
  references?: MarkdownReference[];
  style: "inline" | "block";
}> = ({ value, identifier, maxTableSize, interactive, references, style }) => {
  const { keys: keysToDisplay, notShown } = tableKeys(value, maxTableSize);

  return (
    <div
      className={clsx(styles.valueTable, style === "inline" && styles.inline)}
    >
      {keysToDisplay.map((key, index) => {
        const displayValue = renderValue(
          index,
          value[key],
          identifier,
          references,
          interactive
        );
        return (
          <Fragment key={`value-table-row-${key}`}>
            <div
              className={clsx(
                styles.valueKey,
                "text-style-label",
                "text-style-secondary",
                "text-size-smallest"
              )}
            >
              {key}
            </div>
            <div className={clsx(styles.valueValue)}>{displayValue}</div>
          </Fragment>
        );
      })}
      {notShown > 0 && (
        <Fragment key={`value-table-row-more`}>
          <div
            className={clsx(
              styles.valueKey,
              "text-style-label",
              "text-style-secondary",
              "text-size-smallest"
            )}
          >
            {notShown} more…
          </div>
          <div className={clsx(styles.valueValue)}></div>
        </Fragment>
      )}
    </div>
  );
};

const tableKeys = (
  value: Record<string, unknown>,
  maxTableSize: number
): { keys: string[]; notShown: number } => {
  const sortedKeys = Object.keys(value).sort((a, b) => {
    const aVal = value[a];
    const bVal = value[b];
    if (typeof aVal === "boolean" && typeof bVal === "boolean") {
      return Number(bVal) - Number(aVal);
    } else if (typeof aVal === "number" && typeof bVal === "number") {
      return bVal - aVal;
    } else {
      return 0;
    }
  });
  return {
    keys: sortedKeys.slice(0, maxTableSize),
    notShown: sortedKeys.length - maxTableSize,
  };
};

const cellText = (val: unknown): string => {
  if (typeof val === "string") {
    return val;
  } else if (typeof val === "number") {
    return formatPrettyDecimal(val);
  } else if (typeof val === "boolean") {
    return String(val);
  } else if (val === null) {
    return "null";
  } else if (Array.isArray(val)) {
    return printArray(val, 35);
  } else if (isRecord(val)) {
    return printObject(val, 35);
  } else {
    return "Unknown value type";
  }
};

const renderValue = (
  index: number,
  val: unknown,
  identifier: string | undefined,
  references: MarkdownReference[] | undefined,
  interactive: boolean
): ReactNode => {
  if (typeof val === "string") {
    return <MarkdownDivWithReferences markdown={val} references={references} />;
  } else if (typeof val === "boolean") {
    return (
      <div className={clsx(styles.boolean, val ? styles.true : styles.false)}>
        {String(val)}
      </div>
    );
  } else if (val === null) {
    return <pre className={clsx(styles.value)}>null</pre>;
  } else if (interactive && isRecord(val)) {
    return (
      <RecordTree
        id={`value-record-${identifier ?? "na"}-${index}`}
        record={val}
      />
    );
  } else {
    return cellText(val);
  }
};
