import { FC, ReactNode, useState } from "react";

import { getBootstrap } from "./appConfig";
import styles from "./LogLocationGate.module.css";
import { LogLocationProposal } from "./logLocationTrust";

/**
 * Holds the app before config resolution while a link-named log location on
 * another origin awaits approval. Mounted above `AppConfigGate`: until the
 * user opens the location no api exists and nothing has been requested from
 * that origin. Trusted locations (embedded config, the VS Code host,
 * same-origin links) never produce a proposal and render children directly.
 */
export const LogLocationGate: FC<{ children: ReactNode }> = ({ children }) => {
  const [approved, setApproved] = useState(false);
  const proposal = getBootstrap().logLocationProposal;
  if (!proposal || approved) return children;
  return (
    <LogLocationApproval
      proposal={proposal}
      onApprove={() => setApproved(true)}
    />
  );
};

const stripProposalFromUrl = (): void => {
  const url = new URL(window.location.href);
  url.searchParams.delete("log_dir");
  url.searchParams.delete("log_file");
  window.location.replace(url);
};

const LogLocationApproval: FC<{
  proposal: LogLocationProposal;
  onApprove: () => void;
}> = ({ proposal, onApprove }) => {
  const noun = proposal.kind === "dir" ? "a log directory" : "a log file";
  return (
    <div className={styles.gate} data-testid="log-location-gate">
      <div
        className={styles.card}
        role="alertdialog"
        aria-labelledby="log-location-title"
      >
        <h1 id="log-location-title" className={styles.title}>
          Open logs from {proposal.origin}?
        </h1>
        <p className={styles.body}>
          This link names {noun} on another site. Nothing has been requested
          from it yet. Open it only if you trust where the link came from.
        </p>
        <code className={styles.location}>{proposal.location}</code>
        <div className={styles.actions}>
          <button type="button" className="btn btn-primary" onClick={onApprove}>
            Open
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={stripProposalFromUrl}
          >
            Don&apos;t open
          </button>
        </div>
      </div>
    </div>
  );
};
