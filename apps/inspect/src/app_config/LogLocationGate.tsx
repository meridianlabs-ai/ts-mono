import { FC, ReactNode } from "react";

import { getBootstrap } from "./appConfig";
import styles from "./LogLocationGate.module.css";
import { LogLocationProposal } from "./logLocationTrust";

/**
 * Refuses a link-named log location on another origin. Mounted above
 * `AppConfigGate`, so no api exists and nothing is requested from that
 * origin. The viewer's CSP (`connect-src 'self'`) would block the fetch on
 * every host that serves it, so there is nothing to approve. Trusted
 * locations (embedded config, the VS Code host, same-origin links) never
 * produce a proposal and render children directly.
 */
export const LogLocationGate: FC<{ children: ReactNode }> = ({ children }) => {
  const proposal = getBootstrap().logLocationProposal;
  if (!proposal) return children;
  return <LogLocationRefusal proposal={proposal} />;
};

const stripProposalFromUrl = (): void => {
  const url = new URL(window.location.href);
  url.searchParams.delete("log_dir");
  url.searchParams.delete("log_file");
  window.location.replace(url);
};

const LogLocationRefusal: FC<{ proposal: LogLocationProposal }> = ({
  proposal,
}) => {
  const noun = proposal.kind === "dir" ? "a log directory" : "a log file";
  return (
    <div className={styles.gate} data-testid="log-location-gate">
      <div
        className={styles.card}
        role="alert"
        aria-labelledby="log-location-title"
      >
        <h1 id="log-location-title" className={styles.title}>
          Can&apos;t open logs from {proposal.origin}
        </h1>
        <p className={styles.body}>
          This link names {noun} on another site. The viewer only reads logs
          from the site that serves it, so nothing was requested.
        </p>
        <code className={styles.location}>{proposal.location}</code>
        <p className={styles.body}>
          To view these logs, run <code>inspect view --log-dir</code> with their
          location, or publish them with <code>inspect view bundle</code>.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={stripProposalFromUrl}
          >
            Continue without it
          </button>
        </div>
      </div>
    </div>
  );
};
