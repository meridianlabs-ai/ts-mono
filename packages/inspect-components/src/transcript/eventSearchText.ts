import type { Content } from "@tsmono/inspect-common/types";

import type { EventNode } from "./types";

/**
 * Extracts searchable text from an EventNode for find-in-page functionality.
 */
export const eventSearchText = (node: EventNode): string[] => {
  const texts: string[] = [];
  const event = node.event;

  switch (event.event) {
    case "model": {
      const modelEvent = event;
      // Model name (displayed in title)
      if (modelEvent.model) {
        texts.push(modelEvent.model);
      }
      // Extract text from model output
      if (modelEvent.output?.choices) {
        for (const choice of modelEvent.output.choices) {
          texts.push(...extractContentText(choice.message.content));
        }
      }
      // Extract text from user/system input messages shown in the view
      if (modelEvent.input) {
        for (const msg of modelEvent.input) {
          if (msg.role === "user" || msg.role === "system") {
            texts.push(...extractContentText(msg.content));
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
        texts.push(resolvedTitle);
      }
      // Tool function name
      if (toolEvent.function) {
        texts.push(toolEvent.function);
      }
      // Tool arguments
      if (toolEvent.arguments) {
        texts.push(JSON.stringify(toolEvent.arguments));
      }
      // Tool result
      if (toolEvent.result) {
        if (typeof toolEvent.result === "string") {
          texts.push(toolEvent.result);
        } else {
          texts.push(JSON.stringify(toolEvent.result));
        }
      }
      // Tool error
      if (toolEvent.error?.message) {
        texts.push(toolEvent.error.message);
      }
      break;
    }

    case "error": {
      const errorEvent = event;
      if (errorEvent.error?.message) {
        texts.push(errorEvent.error.message);
      }
      if (errorEvent.error?.traceback) {
        texts.push(errorEvent.error.traceback);
      }
      break;
    }

    case "logger": {
      const loggerEvent = event;
      if (loggerEvent.message?.message) {
        texts.push(loggerEvent.message.message);
      }
      // Filename shown in the view
      if (loggerEvent.message?.filename) {
        texts.push(loggerEvent.message.filename);
      }
      break;
    }

    case "info": {
      const infoEvent = event;
      // Source shown in title
      if (infoEvent.source) {
        texts.push(infoEvent.source);
      }
      if (infoEvent.data) {
        if (typeof infoEvent.data === "string") {
          texts.push(infoEvent.data);
        } else {
          texts.push(JSON.stringify(infoEvent.data));
        }
      }
      break;
    }

    case "branch": {
      const branchEvent = event;
      if (branchEvent.from_span) {
        texts.push(branchEvent.from_span);
      }
      if (branchEvent.from_message) {
        texts.push(branchEvent.from_message);
      }
      break;
    }

    case "compaction": {
      const compactionEvent = event;
      // Source shown in title
      if (compactionEvent.source) {
        texts.push(compactionEvent.source);
      }
      texts.push(JSON.stringify(compactionEvent));
      break;
    }

    case "step": {
      const stepEvent = event;
      if (stepEvent.name) {
        texts.push(stepEvent.name);
      }
      // Type shown in title (e.g., "solver: name")
      if (stepEvent.type) {
        texts.push(stepEvent.type);
      }
      break;
    }

    case "subtask": {
      const subtaskEvent = event;
      if (subtaskEvent.name) {
        texts.push(subtaskEvent.name);
      }
      // Type shown in title
      if (subtaskEvent.type) {
        texts.push(subtaskEvent.type);
      }
      // Input/result shown in summary
      if (subtaskEvent.input) {
        texts.push(JSON.stringify(subtaskEvent.input));
      }
      if (subtaskEvent.result) {
        texts.push(JSON.stringify(subtaskEvent.result));
      }
      break;
    }

    case "span_begin": {
      const spanEvent = event;
      if (spanEvent.name) {
        texts.push(spanEvent.name);
      }
      // Type shown in title
      if (spanEvent.type) {
        texts.push(spanEvent.type);
      }
      break;
    }

    case "score": {
      const scoreEvent = event;
      if (scoreEvent.score.answer) {
        texts.push(scoreEvent.score.answer);
      }
      if (scoreEvent.score.explanation) {
        texts.push(scoreEvent.score.explanation);
      }
      if (scoreEvent.score.value !== undefined) {
        const val = scoreEvent.score.value;
        texts.push(typeof val === "string" ? val : JSON.stringify(val));
      }
      if (scoreEvent.target) {
        if (typeof scoreEvent.target === "string") {
          texts.push(scoreEvent.target);
        } else if (Array.isArray(scoreEvent.target)) {
          texts.push(...scoreEvent.target);
        }
      }
      break;
    }

    case "score_edit": {
      const scoreEditEvent = event;
      if (scoreEditEvent.score_name) {
        texts.push(scoreEditEvent.score_name);
      }
      if (
        scoreEditEvent.edit.answer &&
        scoreEditEvent.edit.answer !== "UNCHANGED"
      ) {
        texts.push(scoreEditEvent.edit.answer);
      }
      if (
        scoreEditEvent.edit.explanation &&
        scoreEditEvent.edit.explanation !== "UNCHANGED"
      ) {
        texts.push(scoreEditEvent.edit.explanation);
      }
      break;
    }

    case "sample_init": {
      const sampleInitEvent = event;
      const sample = sampleInitEvent.sample;
      if (sample.target) {
        if (typeof sample.target === "string") {
          texts.push(sample.target);
        } else {
          texts.push(JSON.stringify(sample.target));
        }
      }
      if (sample.metadata && Object.keys(sample.metadata).length > 0) {
        texts.push(JSON.stringify(sample.metadata));
      }
      break;
    }

    case "sample_limit": {
      const sampleLimitEvent = event;
      if (sampleLimitEvent.message) {
        texts.push(sampleLimitEvent.message);
      }
      if (sampleLimitEvent.type) {
        texts.push(sampleLimitEvent.type);
      }
      break;
    }

    case "input": {
      const inputEvent = event;
      if (inputEvent.input) {
        texts.push(inputEvent.input);
      }
      break;
    }

    case "approval": {
      const approvalEvent = event;
      if (approvalEvent.decision) {
        texts.push(approvalEvent.decision);
      }
      if (approvalEvent.explanation) {
        texts.push(approvalEvent.explanation);
      }
      if (approvalEvent.approver) {
        texts.push(approvalEvent.approver);
      }
      break;
    }

    case "sandbox": {
      const sandboxEvent = event;
      if (sandboxEvent.action) {
        texts.push(sandboxEvent.action);
      }
      if (sandboxEvent.cmd) {
        texts.push(sandboxEvent.cmd);
      }
      if (sandboxEvent.output) {
        texts.push(sandboxEvent.output);
      }
      if (sandboxEvent.file) {
        texts.push(sandboxEvent.file);
      }
      break;
    }

    case "state":
    case "store": {
      const stateEvent = event;
      for (const change of stateEvent.changes) {
        texts.push(change.path);
        if (change.value !== undefined) {
          texts.push(
            typeof change.value === "string"
              ? change.value
              : JSON.stringify(change.value)
          );
        }
      }
      break;
    }
  }

  return texts;
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
