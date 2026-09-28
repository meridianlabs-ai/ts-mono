import clsx from "clsx";
import { FC } from "react";
import { useLocation, useNavigate } from "react-router";

import { InAppLink } from "@tsmono/react/components";
import { navigateAndForget } from "@tsmono/react/hooks";

import { ApplicationIcons } from "../appearance/icons";
import { toFullUrl, useLogOrSampleRouteParams } from "../routing/url";

import styles from "./FlowButton.module.css";

export const FlowButton: FC = () => {
  const navigateRouter = useNavigate();
  const location = useLocation();
  const { logPath } = useLogOrSampleRouteParams();

  // Flow for the current directory, keeping the /samples or /logs context.
  const routePrefix = location.pathname.startsWith("/samples/")
    ? "/samples"
    : "/logs";
  const flowPath = logPath
    ? `${routePrefix}/${logPath}/flow.yaml`
    : `${routePrefix}/flow.yaml`;
  return (
    <div>
      <InAppLink
        href={toFullUrl(flowPath)}
        onNavigate={() => navigateAndForget(navigateRouter, flowPath)}
        className={clsx(styles.button)}
        title="View Flow configuration for this directory"
      >
        <i className={clsx(ApplicationIcons.flow, styles.viewerOptions)} />
      </InAppLink>
    </div>
  );
};
