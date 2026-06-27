import { VscodeButton } from "@vscode-elements/react-elements";
import { FC, useLayoutEffect } from "react";

import type {
  LogLocationController,
  LogLocationRequest,
} from "../client/api/log-location";

import { ApplicationIcons } from "./appearance/icons";
import styles from "./LogLocationGate.module.css";

interface LogLocationGateProps {
  locations: LogLocationController;
  request: LogLocationRequest;
}

export const LogLocationGate: FC<LogLocationGateProps> = ({
  locations,
  request,
}) => {
  const isApproval = request.status === "approval" && !!request.url;
  const label = request.kind === "directory" ? "directory" : "log";

  useLayoutEffect(() => {
    const previousMinWidth = document.body.style.minWidth;
    document.body.style.minWidth = "0";
    return () => {
      document.body.style.minWidth = previousMinWidth;
    };
  }, []);

  return (
    <main className={styles.gate} data-testid="log-location-gate">
      <div className={styles.content}>
        <i
          className={`${ApplicationIcons.approve} ${styles.icon}`}
          aria-hidden="true"
        />
        <div className={styles.body}>
          <h1>
            {isApproval
              ? `Remote ${label} is not loaded`
              : `This ${label} location cannot be loaded`}
          </h1>
          {isApproval ? (
            <>
              <p>
                Loading this {label} contacts <strong>{request.origin}</strong>.
              </p>
              <code className={styles.destination}>{request.url}</code>
              <p>
                Approval applies only to this exact {label} for the current
                page.
              </p>
            </>
          ) : (
            <>
              <code className={styles.destination}>{request.raw}</code>
              <p>{request.reason}</p>
            </>
          )}
          <div className={styles.actions}>
            {isApproval ? (
              <VscodeButton
                onClick={() => {
                  locations.approveRequest();
                }}
                data-testid="approve-log-location"
              >
                Open {label}
              </VscodeButton>
            ) : null}
            <VscodeButton
              secondary
              onClick={() => {
                locations.dismissRequest();
              }}
            >
              Continue without loading
            </VscodeButton>
          </div>
        </div>
      </div>
    </main>
  );
};
