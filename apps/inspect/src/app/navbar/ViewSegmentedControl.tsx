import { FC } from "react";
import { useNavigate } from "react-router";

import { SegmentedControl } from "@tsmono/react/components";
import { navigateAndForget } from "@tsmono/react/hooks";

import { ApplicationIcons } from "../appearance/icons";
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

const segments = [
  { id: "tasks", label: "Tasks", icon: ApplicationIcons.navbar.tasks },
  { id: "logs", label: "Folders", icon: ApplicationIcons.file },
  { id: "samples", label: "Samples", icon: ApplicationIcons.sample },
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
        if (route) navigateAndForget(navigate, route);
      }}
    />
  );
};
