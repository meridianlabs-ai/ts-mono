import clsx from "clsx";
import { FC, Ref } from "react";

import { isRecord } from "@tsmono/util";

import { useContentIcons } from "../../../content/IconsContext";

import styles from "./TodoWriteInput.module.css";

interface ToolTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

const kTodoStatuses: readonly ToolTodo["status"][] = [
  "pending",
  "in_progress",
  "completed",
];

const isTodoStatus = (value: unknown): value is ToolTodo["status"] =>
  kTodoStatuses.some((status) => status === value);

// One malformed entry shouldn't hide the rest of the list: keep every item
// with readable text, and let an unrecognized status fall back to the
// default (unchecked) rendering.
const toToolTodo = (item: unknown): ToolTodo | undefined => {
  if (!isRecord(item)) return undefined;
  const text = [item["content"], item["step"]].find(
    (value): value is string => typeof value === "string"
  );
  if (text === undefined) return undefined;
  return {
    content: text,
    status: isTodoStatus(item["status"]) ? item["status"] : "pending",
  };
};

const toToolTodos = (obj: unknown): ToolTodo[] =>
  Array.isArray(obj)
    ? obj.map(toToolTodo).filter((todo) => todo !== undefined)
    : [];

export const TodoWriteInput: FC<{
  contents: unknown;
  parentRef: Ref<HTMLDivElement>;
}> = ({ contents, parentRef }) => {
  const icons = useContentIcons();
  const todoItems = toToolTodos(contents);
  return (
    <div ref={parentRef} className={clsx(styles.todoList)}>
      {todoItems.map((todo) => {
        return (
          <>
            <i
              className={clsx(
                todo.status === "completed"
                  ? icons.checkbox.checked
                  : icons.checkbox.unchecked,
                "text-size-smallest"
              )}
            />
            <span
              className={clsx(
                "text-size-smallest",
                todo.status === "in_progress" ? styles.inProgress : undefined
              )}
            >
              {todo.content}
            </span>
          </>
        );
      })}
    </div>
  );
};
