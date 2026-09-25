import clsx from "clsx";
import { FC } from "react";
import { useLocation, useNavigate } from "react-router";

import { inAppHref, inAppLinkClick } from "@tsmono/react/components";
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
  const href = inAppHref(toFullUrl(flowPath));
  const navigate = () => navigateAndForget(navigateRouter, flowPath);

  const title = "View Flow configuration for this directory";
  const icon = (
    <i className={clsx(ApplicationIcons.flow, styles.viewerOptions)} />
  );
  return (
    <div>
      {href ? (
        <a
          href={href}
          className={clsx(styles.button)}
          onClick={inAppLinkClick(navigate)}
          title={title}
        >
          {icon}
        </a>
      ) : (
        <button
          type="button"
          className={clsx(styles.button)}
          onClick={navigate}
          title={title}
        >
          {icon}
        </button>
      )}
    </div>
  );
};
