import clsx from "clsx";
import { FC, Ref } from "react";

import { isRecord } from "@tsmono/util";

import { useContentIcons } from "../../../content/IconsContext";

import styles from "./TodoWriteInput.module.css";

interface ToolTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface RawTodo {
  content?: string;
  step?: string;
  status: ToolTodo["status"];
}

const kTodoStatuses: readonly ToolTodo["status"][] = [
  "pending",
  "in_progress",
  "completed",
];

const isTodoStatus = (value: unknown): value is ToolTodo["status"] =>
  kTodoStatuses.some((status) => status === value);

const isRawTodo = (item: unknown): item is RawTodo =>
  isRecord(item) &&
  (typeof item["content"] === "string" || typeof item["step"] === "string") &&
  isTodoStatus(item["status"]);

const toToolTodos = (obj: unknown): ToolTodo[] => {
  if (Array.isArray(obj) && obj.every(isRawTodo)) {
    return obj.map((o) => ({
      content: o.content ?? o.step ?? "",
      status: o.status,
    }));
  }
  return [];
};

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
