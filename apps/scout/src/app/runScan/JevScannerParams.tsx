import {
  VscodeCheckbox,
  VscodeFormHelper,
  VscodeLabel,
  VscodeOption,
  VscodeSingleSelect,
  VscodeTextarea,
  VscodeTextfield,
} from "@vscode-elements/react-elements";
import { FC } from "react";

import { eventChecked, eventValue } from "../utils/formEvents";

import {
  findOption,
  JevScannerParamsValue,
  kJevAnswerTypes,
  kJevRedact,
  kJevReferences,
} from "./jevParams";
import styles from "./ScannerParams.module.css";

interface Props {
  value: JevScannerParamsValue;
  onChange: (value: JevScannerParamsValue) => void;
}

const placeholderByAnswerType = {
  boolean:
    "Did the agent run a destructive command (e.g. rm -rf, git reset --hard)?",
  labels: "How did the user react to the agent's work?",
  numeric: "How much rework did the agent's changes need?",
} as const;

export const JevScannerParams: FC<Props> = ({ value, onChange }) => {
  const update = (partial: Partial<JevScannerParamsValue>) =>
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
            onInput={(e) => update({ question: eventValue(e) })}
          />
        </div>

        {value.answerType === "boolean" && (
          <>
            <div className={styles.formGroup}>
              <VscodeLabel>Yes means (optional)</VscodeLabel>
              <VscodeTextfield
                placeholder="The agent deleted files or discarded work"
                value={value.trueCriterion}
                onInput={(e) => update({ trueCriterion: eventValue(e) })}
              />
            </div>
            <div className={styles.formGroup}>
              <VscodeLabel>No means (optional)</VscodeLabel>
              <VscodeTextfield
                placeholder="Only read-only or reversible commands"
                value={value.falseCriterion}
                onInput={(e) => update({ falseCriterion: eventValue(e) })}
              />
            </div>
          </>
        )}

        {value.answerType === "labels" && (
          <div className={styles.formGroup}>
            <VscodeLabel>Labels</VscodeLabel>
            <VscodeFormHelper>
              One per line. Optionally add a description after a colon.
            </VscodeFormHelper>
            <VscodeTextarea
              rows={5}
              placeholder={
                "Satisfied: accepted the work as is\nCorrected: asked for changes\nFrustrated: complained or gave up"
              }
              value={value.labels}
              onInput={(e) => update({ labels: eventValue(e) })}
            />
          </div>
        )}

        {value.answerType === "numeric" && (
          <div className={styles.formGroup}>
            <VscodeLabel>Rubric</VscodeLabel>
            <VscodeFormHelper>
              2 to 10 score levels, one per line, lowest first. The value is the
              expected level (0 for the first line).
            </VscodeFormHelper>
            <VscodeTextarea
              rows={5}
              placeholder={
                "No rework\nMinor fixes\nSubstantial rework\nRewritten"
              }
              value={value.rubric}
              onInput={(e) => update({ rubric: eventValue(e) })}
            />
          </div>
        )}
      </div>

      <div className={styles.formColumn}>
        <div className={styles.formGroup}>
          <VscodeLabel>Answer type</VscodeLabel>
          <VscodeSingleSelect
            value={value.answerType}
            onChange={(e) =>
              update({
                answerType: findOption(
                  kJevAnswerTypes,
                  eventValue(e),
                  "boolean"
                ),
              })
            }
          >
            <VscodeOption value="boolean">Yes / no</VscodeOption>
            <VscodeOption value="labels">Labels</VscodeOption>
            <VscodeOption value="numeric">Rubric score</VscodeOption>
          </VscodeSingleSelect>
        </div>

        {value.answerType === "boolean" && (
          <div className={styles.formGroup}>
            <VscodeLabel>Threshold</VscodeLabel>
            <VscodeFormHelper>
              Probability at or above which the answer is yes.
            </VscodeFormHelper>
            <VscodeTextfield
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={value.threshold}
              onInput={(e) => update({ threshold: eventValue(e) })}
            />
          </div>
        )}

        <div className={styles.formGroup}>
          <VscodeLabel>Cite evidence</VscodeLabel>
          <VscodeSingleSelect
            value={value.references}
            onChange={(e) =>
              update({
                references: findOption(kJevReferences, eventValue(e), "best"),
              })
            }
          >
            <VscodeOption value="best">Best message</VscodeOption>
            <VscodeOption value="all">All matching messages</VscodeOption>
            <VscodeOption value="none">None</VscodeOption>
          </VscodeSingleSelect>
        </div>

        <div className={styles.formGroup}>
          <VscodeLabel>Redact before sending</VscodeLabel>
          <VscodeSingleSelect
            value={value.redact}
            onChange={(e) =>
              update({ redact: findOption(kJevRedact, eventValue(e), "keys") })
            }
          >
            <VscodeOption value="keys">Keys and credentials</VscodeOption>
            <VscodeOption value="all">
              Keys, credentials and emails
            </VscodeOption>
            <VscodeOption value="off">Nothing</VscodeOption>
          </VscodeSingleSelect>
        </div>

        <div className={styles.formGroup}>
          <VscodeLabel>Model</VscodeLabel>
          <VscodeTextfield
            placeholder="typesafe/jev-1.13.0 (default)"
            value={value.model}
            onInput={(e) => update({ model: eventValue(e) })}
          />
        </div>

        <div className={styles.formGroup}>
          <VscodeLabel>Message filter</VscodeLabel>
          <div className={styles.checkboxGroup}>
            <VscodeCheckbox
              checked={value.excludeSystem}
              onChange={(e) => update({ excludeSystem: eventChecked(e) })}
            >
              Exclude system messages
            </VscodeCheckbox>
            <VscodeCheckbox
              checked={value.excludeReasoning}
              onChange={(e) => update({ excludeReasoning: eventChecked(e) })}
            >
              Exclude reasoning content
            </VscodeCheckbox>
            <VscodeCheckbox
              checked={value.excludeToolUsage}
              onChange={(e) => update({ excludeToolUsage: eventChecked(e) })}
            >
              Exclude tool usage
            </VscodeCheckbox>
          </div>
        </div>
      </div>
    </div>
  );
};
