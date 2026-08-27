import {
  VscodeCheckbox,
  VscodeLabel,
  VscodeOption,
  VscodeSingleSelect,
  VscodeTextarea,
} from "@vscode-elements/react-elements";
import { FC } from "react";

import { eventChecked, eventValue } from "../utils/formEvents";

import styles from "./LlmScannerParams.module.css";

const getInputValue = eventValue;
const getSelectValue = eventValue;

const kAnswerTypes = ["boolean", "numeric", "string"] as const;

type AnswerType = (typeof kAnswerTypes)[number];

/** The select's own options are the answer types; boolean is the default. */
const toAnswerType = (value: string): AnswerType =>
  kAnswerTypes.find((answerType) => answerType === value) ?? "boolean";

export interface LlmScannerParamsValue {
  question: string;
  answerType: AnswerType;
  excludeSystem: boolean;
  excludeReasoning: boolean;
  excludeToolUsage: boolean;
}

interface Props {
  value: LlmScannerParamsValue;
  onChange: (value: LlmScannerParamsValue) => void;
}

const placeholderByAnswerType = {
  boolean: "Enter a yes/no question to ask about each transcript...",
  numeric:
    "Enter a question that yields a numeric answer for each transcript...",
  string: "Enter a question to ask about each transcript...",
} as const;

export const LlmScannerParams: FC<Props> = ({ value, onChange }) => {
  const update = (partial: Partial<LlmScannerParamsValue>) =>
    onChange({ ...value, ...partial });

  return (
    <div className={styles.formRow}>
      <div className={styles.formColumn}>
        <div className={styles.formGroup}>
          <VscodeLabel>Question</VscodeLabel>
          <VscodeTextarea
            rows={4}
            placeholder={placeholderByAnswerType[value.answerType]}
            value={value.question}
            onInput={(e) => update({ question: getInputValue(e) })}
          />
        </div>
      </div>
      <div className={styles.formColumn}>
        <div className={styles.formGroup}>
          <VscodeLabel>Answer type</VscodeLabel>
          <VscodeSingleSelect
            value={value.answerType}
            onChange={(e) =>
              update({ answerType: toAnswerType(getSelectValue(e)) })
            }
          >
            <VscodeOption value="boolean">Boolean</VscodeOption>
            <VscodeOption value="numeric">Numeric</VscodeOption>
            <VscodeOption value="string">String</VscodeOption>
          </VscodeSingleSelect>
        </div>
        <div className={styles.formGroup}>
          <VscodeLabel>Message filter</VscodeLabel>
          <div className={styles.checkboxGroup}>
            <VscodeCheckbox
              checked={value.excludeSystem}
              onChange={(e) =>
                update({
                  excludeSystem: eventChecked(e),
                })
              }
            >
              Exclude system messages
            </VscodeCheckbox>
            <VscodeCheckbox
              checked={value.excludeReasoning}
              onChange={(e) =>
                update({
                  excludeReasoning: eventChecked(e),
                })
              }
            >
              Exclude reasoning content
            </VscodeCheckbox>
            <VscodeCheckbox
              checked={value.excludeToolUsage}
              onChange={(e) =>
                update({
                  excludeToolUsage: eventChecked(e),
                })
              }
            >
              Exclude tool usage
            </VscodeCheckbox>
          </div>
        </div>
      </div>
    </div>
  );
};
