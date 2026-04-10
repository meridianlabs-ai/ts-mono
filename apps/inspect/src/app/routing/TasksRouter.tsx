import { FC } from "react";

import { TasksPanel } from "../tasks-panel/TasksPanel";

/**
 * Router component for /tasks/* paths.
 * Currently just renders the flat TasksPanel.
 * Clicking individual tasks navigates to /logs/* for the standard log viewer.
 */
export const TasksRouter: FC = () => {
  return <TasksPanel />;
};
