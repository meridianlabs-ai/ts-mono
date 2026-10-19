import { IconName } from "@tsmono/react/icons";

declare const __SCOUT_RUN_SCAN__: boolean;

export interface ActivityConfig {
  id: string;
  label: string;
  icon: IconName;
  route: string;
  routePatterns?: string[];
  description?: string;
}

const allActivities: ActivityConfig[] = [
  {
    id: "project",
    label: "Project",
    icon: "config",
    route: "/project",
    routePatterns: ["/project"],
    description: "Project settings",
  },
  {
    id: "transcripts",
    label: "Transcripts",
    icon: "transcript",
    route: "/transcripts",
    description: "View transcripts",
  },
  {
    id: "scans",
    label: "Scans",
    icon: "scanner",
    route: "/scans",
    routePatterns: ["/scans", "/scan"],
    description: "View results",
  },
  {
    id: "runScan",
    label: "Run Scan",
    icon: "play",
    route: "/run",
    description: "Run scans and view active scans",
  },
  {
    id: "validation",
    label: "Validation",
    icon: "validation",
    route: "/validation",
    routePatterns: ["/validation"],
    description: "Manage validation sets",
  },
];

export const activities = allActivities.filter((a) => {
  if (a.id === "runScan" && !__SCOUT_RUN_SCAN__) return false;
  return true;
});

export const getActivityByRoute = (
  path: string
): ActivityConfig | undefined => {
  // Match against routePatterns if defined, otherwise fall back to the primary route
  return activities.find((activity) => {
    const patterns = activity.routePatterns || [activity.route];
    return patterns.some((pattern) => path.startsWith(pattern));
  });
};

export const getActivityById = (id: string): ActivityConfig | undefined => {
  return activities.find((activity) => activity.id === id);
};
