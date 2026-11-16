import clsx from "clsx";
import { FC, ReactNode } from "react";

interface TaskNameProps {
  taskSet?: string | null;
  taskId?: string | number | null;
  taskRepeat?: number | null;
}

export const TaskName: FC<TaskNameProps> = ({
  taskSet,
  taskId,
  taskRepeat,
}) => {
  if (!taskSet && !taskId && taskRepeat === undefined) {
    return "<unknown>";
  }

  const results: ReactNode[] = [];

  if (taskSet) {
    results.push(<span key={"task-column-task-set"}>{taskSet}</span>);
  }

  if (taskId !== undefined && taskId !== null) {
    results.push("/", <span key={"task-column-task-id"}>{taskId}</span>);
  }

  if (taskRepeat !== undefined && taskRepeat !== null) {
    results.push(
      " ",
      <span
        key={"task-column-task-repeat"}
        className={clsx("text-style-secondary", "text-size-smallest")}
      >{`(${taskRepeat})`}</span>
    );
  }

  return results;
};

/** The text `<TaskName>` renders. */
export const taskNameText = ({
  taskSet,
  taskId,
  taskRepeat,
}: TaskNameProps): string => {
  if (!taskSet && !taskId && taskRepeat === undefined) {
    return "<unknown>";
  }
  let text = taskSet || "";
  if (taskId !== undefined && taskId !== null) text += `/${taskId}`;
  if (taskRepeat !== undefined && taskRepeat !== null) {
    text += ` (${taskRepeat})`;
  }
  return text;
};
