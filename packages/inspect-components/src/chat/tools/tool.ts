import type { ToolCallContent } from "@tsmono/inspect-common/types";

export const kToolTodoContentType = "agent/todo-list";

export interface ToolCallResult {
  name: string;
  functionCall: string;
  input?: unknown;
  description?: string;
  contentType?: string;
}

/**
 * Resolves the input and metadata for a given tool call.
 */
export const resolveToolInput = (
  fn: string,
  toolArgs: Record<string, unknown>
): ToolCallResult => {
  const toolName = fn;

  const inputDescriptor = extractInputMetadata(toolName);
  const { input, description, args } = extractInput(toolArgs, inputDescriptor);
  const functionCall =
    args.length > 0 ? `${toolName}(${args.join(", ")})` : toolName;

  // For Task tool, use the subagent_type as the display name
  if (
    (fn === "Task" || fn === "task") &&
    typeof toolArgs.subagent_type === "string"
  ) {
    const subagentType = toolArgs.subagent_type;
    return {
      name: fn,
      functionCall: `Task: ${subagentType}`,
      input,
      description,
      contentType: "markdown",
    };
  }

  return {
    name: fn,
    functionCall,
    input,
    description,
    contentType: inputDescriptor?.contentType,
  };
};

interface ToolInputDescriptor {
  inputArg?: string | string[];
  descriptionArg?: string;
  contentType?: string;
  inputToStr?: (input: unknown) => string | undefined;
}

const extractInputMetadata = (
  toolName: string
): ToolInputDescriptor | undefined => {
  if (toolName === "bash") {
    return {
      inputArg: ["cmd", "command"],
      contentType: "bash",
    };
  } else if (toolName === "python") {
    return {
      inputArg: "code",
      contentType: "python",
    };
  } else if (toolName === "web_search") {
    return {
      inputArg: "query",
      contentType: "json",
    };
  } else if (toolName === "Bash") {
    return {
      inputArg: "command",
      descriptionArg: "description",
      contentType: "bash",
    };
  } else if (toolName === "shell_command") {
    return {
      inputArg: "command",
      descriptionArg: "description",
      contentType: "bash",
    };
  } else if (toolName === "shell") {
    return {
      inputArg: "command",
      contentType: "bash",
      inputToStr: (input: unknown) => {
        if (Array.isArray(input)) {
          return input.join(" ");
        }
        return undefined;
      },
    };
  } else if (toolName == "TodoWrite") {
    return {
      inputArg: "todos",
      contentType: kToolTodoContentType,
    };
  } else if (toolName == "update_plan") {
    return {
      inputArg: "plan",
      contentType: kToolTodoContentType,
    };
  } else if (toolName == "todo_write") {
    return {
      inputArg: "todos",
      contentType: kToolTodoContentType,
    };
  } else if (toolName === "Task") {
    return {
      inputArg: "prompt",
      descriptionArg: "description",
      contentType: "markdown",
    };
  } else if (toolName === "task") {
    return {
      inputArg: "prompt",
      descriptionArg: "task_description",
      contentType: "markdown",
    };
  } else {
    return undefined;
  }
};

/**
 * Substitutes `{{param_name}}` placeholders in tool call content
 * with actual values from the tool call arguments.
 */
export const substituteToolCallContent = (
  content: ToolCallContent,
  args: Record<string, unknown>
): ToolCallContent => {
  const replace = (text: string): string =>
    text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
      Object.hasOwn(args, key) ? String(args[key]) : match
    );
  return {
    ...content,
    title: content.title ? replace(content.title) : content.title,
    content: replace(content.content),
  };
};

const extractInput = (
  args: Record<string, unknown>,
  inputDescriptor?: ToolInputDescriptor
): { input?: unknown; description?: string; args: string[] } => {
  const formatArg = (key: string, value: unknown) => {
    const quotedValue =
      value === null
        ? "None"
        : typeof value === "string"
          ? `"${value}"`
          : typeof value === "object" || Array.isArray(value)
            ? JSON.stringify(value, undefined, 2)
            : // Remaining cases are number | boolean | bigint | symbol | undefined
              // — all safe for String().
              // eslint-disable-next-line @typescript-eslint/no-base-to-string
              String(value);
    return `${key}: ${quotedValue}`;
  };

  // No args
  if (!args) {
    return {
      args: [],
    };
  }

  // Use the input descriptor to snip apart args
  if (inputDescriptor) {
    const filterKeys = new Set<string>();
    const base: { input?: unknown; description?: string } = {};

    if (inputDescriptor.inputArg) {
      // Support string | string[] for inputArg
      const inputArgs = Array.isArray(inputDescriptor.inputArg)
        ? inputDescriptor.inputArg
        : [inputDescriptor.inputArg];

      // Find the first matching arg key
      const matchedKey = inputArgs.find((key) => args[key] !== undefined);
      if (matchedKey) {
        filterKeys.add(matchedKey);
        base.input = inputDescriptor.inputToStr
          ? inputDescriptor.inputToStr(args[matchedKey]) || args[matchedKey]
          : args[matchedKey];
      }

      // Filter all candidate keys from the display args
      for (const key of inputArgs) {
        filterKeys.add(key);
      }
    }

    if (
      inputDescriptor.descriptionArg &&
      args[inputDescriptor.descriptionArg]
    ) {
      filterKeys.add(inputDescriptor.descriptionArg);
      base.description = String(args[inputDescriptor.descriptionArg]);
    }

    const filteredArgs = Object.keys(args)
      .filter((key) => {
        return !filterKeys.has(key);
      })
      .map((key) => {
        return formatArg(key, args[key]);
      });

    return {
      ...base,
      args: filteredArgs,
    };
  } else {
    const formattedArgs = Object.keys(args).map((key) => {
      return formatArg(key, args[key]);
    });

    return {
      args: formattedArgs,
    };
  }
};
