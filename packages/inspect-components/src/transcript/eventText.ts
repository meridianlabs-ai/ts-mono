import type { Content } from "@tsmono/inspect-common/types";

import type { EventType } from "./types";
import { EventNode } from "./types";

/**
 * Extracts labeled fields from an event for search and text serialization.
 */
const extractEventFields = (event: EventType): [string, string][] => {
  const fields: [string, string][] = [];

  switch (event.event) {
    case "model": {
      const modelEvent = event;
      // Model name (displayed in title)
      if (modelEvent.model) {
        fields.push(["model", modelEvent.model]);
      }
      // Extract text from model output
      if (modelEvent.output?.choices) {
        for (const choice of modelEvent.output.choices) {
          for (const text of extractContentText(choice.message.content)) {
            fields.push(["output", text]);
          }
        }
      }
      // Extract text from user/system input messages shown in the view
      if (modelEvent.input) {
        for (const msg of modelEvent.input) {
          if (msg.role === "user" || msg.role === "system") {
            for (const text of extractContentText(msg.content)) {
              fields.push([msg.role, text]);
            }
          }
        }
      }
      break;
    }

    case "tool": {
      const toolEvent = event;
      // Custom tool title (displayed instead of function name)
      if (toolEvent.view?.title) {
        const resolvedTitle = toolEvent.view.title.replace(
          /\{\{(\w+)\}\}/g,
          (match, key: string) => {
            if (!Object.hasOwn(toolEvent.arguments, key)) return match;
            const val =
              toolEvent.arguments[key as keyof typeof toolEvent.arguments];
            return typeof val === "string" ? val : JSON.stringify(val);
          }
        );
        fields.push(["title", resolvedTitle]);
      }
      // Tool function name
      if (toolEvent.function) {
        fields.push(["function", toolEvent.function]);
      }
      // Tool arguments
      if (toolEvent.arguments) {
        fields.push(["arguments", JSON.stringify(toolEvent.arguments)]);
      }
      // Tool result
      if (toolEvent.result) {
        if (typeof toolEvent.result === "string") {
          fields.push(["result", toolEvent.result]);
        } else {
          fields.push(["result", JSON.stringify(toolEvent.result)]);
        }
      }
      // Tool error
      if (toolEvent.error?.message) {
        fields.push(["error", toolEvent.error.message]);
      }
      break;
    }

    case "error": {
      const errorEvent = event;
      if (errorEvent.error?.message) {
        fields.push(["message", errorEvent.error.message]);
      }
      if (errorEvent.error?.traceback) {
        fields.push(["traceback", errorEvent.error.traceback]);
      }
      break;
    }

    case "logger": {
      const loggerEvent = event;
      if (loggerEvent.message?.message) {
        fields.push(["message", loggerEvent.message.message]);
      }
      // Filename shown in the view
      if (loggerEvent.message?.filename) {
        fields.push(["filename", loggerEvent.message.filename]);
      }
      break;
    }

    case "info": {
      const infoEvent = event;
      // Source shown in title
      if (infoEvent.source) {
        fields.push(["source", infoEvent.source]);
      }
      if (infoEvent.data) {
        if (typeof infoEvent.data === "string") {
          fields.push(["data", infoEvent.data]);
        } else {
          fields.push(["data", JSON.stringify(infoEvent.data)]);
        }
      }
      break;
    }

    case "branch": {
      const branchEvent = event;
      if (branchEvent.from_span) {
        fields.push(["from_span", branchEvent.from_span]);
      }
      if (branchEvent.from_anchor) {
        fields.push(["from_anchor", branchEvent.from_anchor]);
      }
      break;
    }

    case "anchor": {
      fields.push(["anchor_id", event.anchor_id]);
      if (event.source) fields.push(["source", event.source]);
      break;
    }

    case "compaction": {
      const compactionEvent = event;
      // Source shown in title
      if (compactionEvent.source) {
        fields.push(["source", compactionEvent.source]);
      }
      fields.push(["event", JSON.stringify(compactionEvent)]);
      break;
    }

    case "step": {
      const stepEvent = event;
      if (stepEvent.name) {
        fields.push(["name", stepEvent.name]);
      }
      // Type shown in title (e.g., "solver: name")
      if (stepEvent.type) {
        fields.push(["type", stepEvent.type]);
      }
      break;
    }

    case "subtask": {
      const subtaskEvent = event;
      if (subtaskEvent.name) {
        fields.push(["name", subtaskEvent.name]);
      }
      // Type shown in title
      if (subtaskEvent.type) {
        fields.push(["type", subtaskEvent.type]);
      }
      // Input/result shown in summary
      if (subtaskEvent.input) {
        fields.push(["input", JSON.stringify(subtaskEvent.input)]);
      }
      if (subtaskEvent.result) {
        fields.push(["result", JSON.stringify(subtaskEvent.result)]);
      }
      break;
    }

    case "span_begin": {
      const spanEvent = event;
      if (spanEvent.name) {
        fields.push(["name", spanEvent.name]);
      }
      // Type shown in title
      if (spanEvent.type) {
        fields.push(["type", spanEvent.type]);
      }
      break;
    }

    case "score": {
      const scoreEvent = event;
      if (scoreEvent.score.answer) {
        fields.push(["answer", scoreEvent.score.answer]);
      }
      if (scoreEvent.score.explanation) {
        fields.push(["explanation", scoreEvent.score.explanation]);
      }
      if (scoreEvent.score.value !== undefined) {
        const val = scoreEvent.score.value;
        fields.push([
          "value",
          typeof val === "string" ? val : JSON.stringify(val),
        ]);
      }
      if (scoreEvent.target) {
        if (typeof scoreEvent.target === "string") {
          fields.push(["target", scoreEvent.target]);
        } else if (Array.isArray(scoreEvent.target)) {
          for (const t of scoreEvent.target) {
            fields.push(["target", t]);
          }
        }
      }
      break;
    }

    case "score_edit": {
      const scoreEditEvent = event;
      if (scoreEditEvent.score_name) {
        fields.push(["score_name", scoreEditEvent.score_name]);
      }
      if (
        scoreEditEvent.edit.answer &&
        scoreEditEvent.edit.answer !== "UNCHANGED"
      ) {
        fields.push(["answer", scoreEditEvent.edit.answer]);
      }
      if (
        scoreEditEvent.edit.explanation &&
        scoreEditEvent.edit.explanation !== "UNCHANGED"
      ) {
        fields.push(["explanation", scoreEditEvent.edit.explanation]);
      }
      break;
    }

    case "sample_init": {
      const sampleInitEvent = event;
      const sample = sampleInitEvent.sample;
      if (sample.target) {
        if (typeof sample.target === "string") {
          fields.push(["target", sample.target]);
        } else {
          fields.push(["target", JSON.stringify(sample.target)]);
        }
      }
      if (sample.metadata && Object.keys(sample.metadata).length > 0) {
        fields.push(["metadata", JSON.stringify(sample.metadata)]);
      }
      break;
    }

    case "sample_limit": {
      const sampleLimitEvent = event;
      if (sampleLimitEvent.message) {
        fields.push(["message", sampleLimitEvent.message]);
      }
      if (sampleLimitEvent.type) {
        fields.push(["type", sampleLimitEvent.type]);
      }
      break;
    }

    case "input": {
      const inputEvent = event;
      if (inputEvent.input) {
        fields.push(["input", inputEvent.input]);
      }
      break;
    }

    case "approval": {
      const approvalEvent = event;
      if (approvalEvent.decision) {
        fields.push(["decision", approvalEvent.decision]);
      }
      if (approvalEvent.explanation) {
        fields.push(["explanation", approvalEvent.explanation]);
      }
      if (approvalEvent.approver) {
        fields.push(["approver", approvalEvent.approver]);
      }
      break;
    }

    case "sandbox": {
      const sandboxEvent = event;
      if (sandboxEvent.action) {
        fields.push(["action", sandboxEvent.action]);
      }
      if (sandboxEvent.cmd) {
        fields.push(["cmd", sandboxEvent.cmd]);
      }
      if (sandboxEvent.output) {
        fields.push(["output", sandboxEvent.output]);
      }
      if (sandboxEvent.file) {
        fields.push(["file", sandboxEvent.file]);
      }
      break;
    }

    case "state":
    case "store": {
      const stateEvent = event;
      for (const change of stateEvent.changes) {
        fields.push(["path", change.path]);
        if (change.value !== undefined) {
          fields.push([
            "value",
            typeof change.value === "string"
              ? change.value
              : JSON.stringify(change.value),
          ]);
        }
      }
      break;
    }
  }

  return fields;
};

/**
 * Extracts searchable text from an EventNode for find-in-page functionality.
 */
export const eventSearchText = (node: EventNode): string[] => {
  return extractEventFields(node.event).map(([, v]) => v);
};

/**
 * Converts an array of events to a human-readable text transcript.
 */
export const eventsToStr = (events: EventType[]): string => {
  return events
    .map((event) => {
      const fields = extractEventFields(event);
      if (fields.length === 0) return null;
      const body = fields
        .map(([k, v]) => (v.includes("\n") ? `${k}:\n${v}` : `${k}: ${v}`))
        .join("\n");
      return `[${event.event}]\n${body}`;
    })
    .filter((s): s is string => s !== null)
    .join("\n\n");
};

/**
 * Extracts text strings from message content.
 */
const extractContentText = (content: string | Array<Content>): string[] => {
  if (typeof content === "string") {
    return [content];
  }

  const texts: string[] = [];
  for (const item of content) {
    switch (item.type) {
      case "text":
        texts.push(item.text);
        break;
      case "reasoning": {
        const reasoning = item;
        if (reasoning.reasoning) {
          texts.push(reasoning.reasoning);
        } else if (reasoning.summary) {
          texts.push(reasoning.summary);
        }
        break;
      }
      case "tool_use": {
        const toolUse = item;
        if (toolUse.name) {
          texts.push(toolUse.name);
        }
        if (toolUse.arguments) {
          texts.push(JSON.stringify(toolUse.arguments));
        }
        break;
      }
    }
  }
  return texts;
};
