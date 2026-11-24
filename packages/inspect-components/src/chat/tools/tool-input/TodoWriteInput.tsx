import clsx from "clsx";
import { FC, Ref } from "react";

import { ContentText } from "@tsmono/react/components";
import { Icon } from "@tsmono/react/icons";

import { toToolTodos } from "../tool";

import styles from "./TodoWriteInput.module.css";

export const TodoWriteInput: FC<{
  contents: unknown;
  parentRef: Ref<HTMLDivElement>;
}> = ({ contents, parentRef }) => {
  const todoItems = toToolTodos(contents);
  return (
    <div ref={parentRef} className={clsx(styles.todoList)}>
      {todoItems.map((todo) => {
        return (
          <>
            <Icon
              name={
                todo.status === "completed"
                  ? "checkboxChecked"
                  : "checkboxUnchecked"
              }
              className="text-size-smallest"
            />
            <span
              className={clsx(
                "text-size-smallest",
                todo.status === "in_progress" ? styles.inProgress : undefined
              )}
            >
              <ContentText text={todo.content} />
            </span>
          </>
        );
      })}
    </div>
  );
};
