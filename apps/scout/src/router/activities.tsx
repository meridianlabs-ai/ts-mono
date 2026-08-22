import { ApplicationIcons } from "../icons";

declare const __SCOUT_RUN_SCAN__: boolean;

export interface ActivityConfig {
  id: string;
  label: string;
  icon: string;
  route: string;
  routePatterns?: string[];
  description?: string;
}

const allActivities: ActivityConfig[] = [
  {
    id: "project",
    label: "Project",
    icon: ApplicationIcons.config,
    route: "/project",
    routePatterns: ["/project"],
    description: "Project settings",
  },
  {
    id: "transcripts",
    label: "Transcripts",
    icon: ApplicationIcons.transcript,
    route: "/transcripts",
    description: "View transcripts",
  },
  {
    id: "scans",
    label: "Scans",
    icon: ApplicationIcons.scanner,
    route: "/scans",
    routePatterns: ["/scans", "/scan"],
    description: "View results",
  },
  {
    id: "runScan",
    label: "Run Scan",
    icon: ApplicationIcons.play,
    route: "/run",
    description: "Run scans and view active scans",
  },
  {
    id: "validation",
    label: "Validation",
    icon: ApplicationIcons.validation,
    route: "/validation",
    routePatterns: ["/validation"],
    description: "Manage validation sets",
  },
];

export const activities = allActivities.filter(
  (a) => !(a.id === "runScan" && !__SCOUT_RUN_SCAN__)
);

const kStaticBundleHiddenActivities = new Set([
  "runScan",
  "project",
  "validation",
]);

/**
 * Activities to render, hiding backend-dependent surfaces in static bundles.
 * Must be applied at render time: the static-bundle signal comes from the api
 * object created in main.tsx, which runs after all module bodies evaluate.
 */
export const visibleActivities = (staticBundle: boolean): ActivityConfig[] =>
  staticBundle
    ? activities.filter((a) => !kStaticBundleHiddenActivities.has(a.id))
    : activities;

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
