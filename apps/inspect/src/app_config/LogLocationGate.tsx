import { VscodeButton } from "@vscode-elements/react-elements";
import { FC, ReactNode, useState } from "react";

import { useEventListener } from "@tsmono/react/hooks";
import { dirname } from "@tsmono/util";

import {
  evaluateLogLocation,
  grantLogLocation,
  LogLocationDecision,
  LogLocationScope,
  validateProxiedLogLocation,
} from "../client/api/logLocation";

import { AppConfig, resolveLogFileLocation, setLogRoot } from "./appConfig";
import styles from "./LogLocationGate.module.css";

interface Request {
  kind: "file" | "directory";
  location: string;
  decision: Exclude<LogLocationDecision, { status: "allowed" }>;
  source: "startup" | "hash" | "message";
}

const routeLogLocation = (hash: string): string | undefined => {
  const path = hash.replace(/^#/, "").split("?")[0] ?? "";
  const match = path.match(/^\/(?:logs|tasks|samples)\/(.+)$/);
  if (!match?.[1]) return undefined;
  try {
    const decoded = decodeURIComponent(match[1]);
    return decoded.match(/^(.+?\.(?:eval|json))(?:\/|$)/)?.[1] ?? decoded;
  } catch {
    return match[1];
  }
};

const asProposal = (
  location: string,
  kind: Request["kind"],
  source: Request["source"],
  proxied = false
): Request => {
  const decision = proxied
    ? validateProxiedLogLocation(location)
    : evaluateLogLocation(location, { kind, location });
  if (decision.status === "blocked") {
    return { kind, location, decision, source };
  }
  const origin = (() => {
    try {
      return new URL(decision.href, window.location.href).origin;
    } catch {
      return window.location.origin;
    }
  })();
  return {
    kind,
    location,
    decision: { status: "approval", href: decision.href, origin },
    source,
  };
};

const evaluateAgainstScopes = (
  location: string,
  scopes: LogLocationScope[]
): LogLocationDecision => {
  for (const scope of scopes) {
    const decision = evaluateLogLocation(location, scope);
    if (decision.status === "allowed") return decision;
  }
  return evaluateLogLocation(
    location,
    scopes[0] ?? {
      kind: "directory",
      location: window.location.origin,
    }
  );
};

const isAbsoluteLocation = (location: string): boolean =>
  location.startsWith("/") || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(location);

const isUpdateStateMessage = (
  value: unknown
): value is { type: "updateState"; url: string } => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "type" in value &&
    value.type === "updateState" &&
    "url" in value &&
    typeof value.url === "string"
  );
};

const decodeLocation = (location: string): string => {
  try {
    return decodeURIComponent(location);
  } catch {
    return location;
  }
};

export const LogLocationGate: FC<{
  config: AppConfig;
  children: ReactNode;
}> = ({ config, children }) => {
  const [hash, setHash] = useState(() => window.location.hash);
  const [approved, setApproved] = useState<LogLocationScope>();
  const [messageRequest, setMessageRequest] = useState<Request>();

  useEventListener(window, "hashchange", () => {
    setHash(window.location.hash);
  });
  useEventListener(window, "message", (event) => {
    if (!isUpdateStateMessage(event.data)) return;
    const location = decodeLocation(event.data.url);
    setMessageRequest(
      asProposal(location, "file", "message", !config.browserDirect)
    );
  });

  const configuredScope = config.locationScope ?? {
    kind: "directory" as const,
    location: config.logDir,
  };
  const scopes = [
    ...(config.browserDirect && !config.startupProposal
      ? [configuredScope]
      : []),
    ...(approved ? [approved] : []),
  ];

  const startupRequest =
    config.startupProposal &&
    (!approved ||
      evaluateLogLocation(config.startupProposal.location, approved).status !==
        "allowed")
      ? asProposal(
          config.startupProposal.location,
          config.startupProposal.kind,
          "startup",
          !config.browserDirect
        )
      : undefined;

  const hashLocation = routeLogLocation(hash);
  const hashDecision = (() => {
    if (!hashLocation) return undefined;
    if (!config.browserDirect) {
      const proxiedDecision = validateProxiedLogLocation(hashLocation);
      if (
        proxiedDecision.status === "allowed" &&
        (!isAbsoluteLocation(hashLocation) ||
          (approved?.kind === "file" && approved.location === hashLocation))
      ) {
        return proxiedDecision;
      }
      return proxiedDecision.status === "blocked"
        ? proxiedDecision
        : asProposal(hashLocation, "file", "hash", true).decision;
    }
    const scopedDecision =
      scopes.length > 0
        ? evaluateAgainstScopes(hashLocation, scopes)
        : undefined;
    return scopedDecision?.status === "allowed"
      ? scopedDecision
      : asProposal(hashLocation, "file", "hash").decision;
  })();
  const hashRequest =
    hashLocation && hashDecision && hashDecision.status !== "allowed"
      ? {
          kind: "file" as const,
          location: hashLocation,
          decision: hashDecision,
          source: "hash" as const,
        }
      : undefined;
  const request = startupRequest ?? messageRequest ?? hashRequest;

  if (!request) return children;

  const approval = request.decision.status === "approval";
  const label = request.kind === "directory" ? "directory" : "log";
  const displayedLocation =
    request.decision.status === "blocked"
      ? request.decision.raw
      : request.decision.href;

  const approve = () => {
    if (request.decision.status !== "approval") return;
    const grantedLocation = config.browserDirect
      ? request.decision.href
      : request.kind === "file"
        ? resolveLogFileLocation(request.location, config.logDir)
        : request.location;
    const grant = {
      kind: request.kind,
      location: grantedLocation,
    } satisfies LogLocationScope;
    grantLogLocation(grant);
    setApproved(grant);
    if (request.source === "message") {
      setMessageRequest(undefined);
      setLogRoot(dirname(grantedLocation), grant);
      window.location.hash = `#/logs/${encodeURIComponent(grantedLocation)}`;
    }
  };

  const dismiss = () => {
    if (request.source === "startup") {
      const url = new URL(window.location.href);
      url.searchParams.delete("log_file");
      url.searchParams.delete("log_dir");
      window.location.replace(url);
    } else if (request.source === "hash") {
      window.location.hash = "#/";
    } else {
      setMessageRequest(undefined);
    }
  };

  return (
    <main className={styles.gate} data-testid="log-location-gate">
      <section className={styles.content}>
        <h1 className={styles.heading}>
          {approval
            ? `Remote ${label} is not loaded`
            : `This ${label} location cannot be loaded`}
        </h1>
        {request.decision.status === "approval" ? (
          <p>
            Loading this {label} contacts{" "}
            <strong>{request.decision.origin}</strong>.
          </p>
        ) : (
          <p>{request.decision.reason}</p>
        )}
        <code className={styles.destination}>{displayedLocation}</code>
        {approval && (
          <p>Approval applies only to this exact {label} for this page.</p>
        )}
        <div className={styles.actions}>
          {approval && (
            <VscodeButton data-testid="approve-log-location" onClick={approve}>
              Open {label}
            </VscodeButton>
          )}
          <VscodeButton secondary onClick={dismiss}>
            Continue without loading
          </VscodeButton>
        </div>
      </section>
    </main>
  );
};
