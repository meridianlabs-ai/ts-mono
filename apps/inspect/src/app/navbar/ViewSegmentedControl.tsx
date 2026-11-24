import { FC } from "react";
import { useNavigate } from "react-router";

import { Segment, SegmentedControl } from "@tsmono/react/components";

import {
  logsUrl,
  samplesUrl,
  tasksUrl,
  toFullUrlMaybe,
  useLogRouteParams,
  useSamplesRouteParams,
  useTasksRouteParams,
} from "../routing/url";

interface ViewSegmentControlProps {
  selectedSegment: "logs" | "tasks" | "samples";
}

const segments: Segment[] = [
  { id: "tasks", label: "Tasks", icon: "navTasks" },
  { id: "logs", label: "Folders", icon: "file" },
  { id: "samples", label: "Samples", icon: "sample" },
];

export const ViewSegmentedControl: FC<ViewSegmentControlProps> = ({
  selectedSegment,
}) => {
  const navigate = useNavigate();
  const { logPath } = useLogRouteParams();
  const { samplesPath } = useSamplesRouteParams();
  const { tasksPath } = useTasksRouteParams();
  // Resolve the current path from whichever route we're on
  const path = logPath || samplesPath || tasksPath || "";
  const routes: Record<string, string> = {
    tasks: tasksUrl(path),
    logs: logsUrl(path),
    samples: samplesUrl(path),
  };

  return (
    <SegmentedControl
      segments={segments.map((segment) => ({
        ...segment,
        href: toFullUrlMaybe(routes[segment.id]),
      }))}
      selectedId={selectedSegment}
      onSegmentChange={(segment) => {
        const route = routes[segment];
        if (route) navigate(route);
      }}
    />
  );
};
