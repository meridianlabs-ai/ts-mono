export interface LogLocationScope {
  kind: "file" | "directory";
  location: string;
}

export type LogLocationDecision =
  | { status: "allowed"; href: string }
  | { status: "approval"; href: string; origin: string }
  | { status: "blocked"; raw: string; reason: string };
type BlockedDecision = Extract<LogLocationDecision, { status: "blocked" }>;

let configuredScope: LogLocationScope | undefined;
let adHocGrant: LogLocationScope | undefined;
let policyConfigured = false;

const schemePattern = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const authoritySchemePattern = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;

const blocked = (raw: string, reason: string): BlockedDecision => ({
  status: "blocked",
  raw,
  reason,
});

const documentBase = (): string =>
  typeof document === "undefined" ? "http://localhost/" : document.baseURI;

const decodeSafeSegment = (segment: string): string | undefined => {
  let decoded = segment;
  for (let depth = 0; depth <= segment.length; depth++) {
    if (decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      return undefined;
    }
    if (!/%[0-9a-fA-F]{2}/.test(decoded)) {
      return decoded.includes("%") ? undefined : decoded;
    }
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const hasSafeRawPath = (raw: string): boolean => {
  let path = raw;
  const authority = authoritySchemePattern.exec(raw);
  if (authority) {
    const pathStart = raw.indexOf("/", authority[0].length);
    path = pathStart < 0 ? "" : raw.slice(pathStart);
  }
  path = path.split(/[?#]/, 1)[0] ?? "";
  return path
    .split("/")
    .filter(Boolean)
    .every((segment) => decodeSafeSegment(segment) !== undefined);
};

const parseLocation = (
  raw: string,
  base: string | URL,
  kind: LogLocationScope["kind"],
  allowedProtocols: readonly string[] = ["http:", "https:"]
): URL | BlockedDecision => {
  if (!raw || raw.trim() !== raw) {
    return blocked(raw, "The log location is empty or has outer whitespace.");
  }
  if (
    Array.from(raw).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    return blocked(raw, "Control characters are not supported in log URLs.");
  }
  if (raw.startsWith("//")) {
    return blocked(raw, "Protocol-relative log locations are not supported.");
  }
  if (schemePattern.test(raw) && !authoritySchemePattern.test(raw)) {
    return blocked(
      raw,
      "Absolute log URLs must include an explicit authority."
    );
  }
  if (raw.includes("\\")) {
    return blocked(raw, "Backslashes are not supported in browser log URLs.");
  }
  if (!hasSafeRawPath(raw)) {
    return blocked(raw, "The log location contains an unsafe path segment.");
  }

  let location: URL;
  try {
    location = new URL(raw, base);
  } catch {
    return blocked(raw, "The log location is not a valid URL.");
  }
  if (!allowedProtocols.includes(location.protocol)) {
    return blocked(
      raw,
      `The ${location.protocol || "unknown"} protocol is not supported.`
    );
  }
  if (location.username || location.password) {
    return blocked(raw, "Credential-bearing log URLs are not supported.");
  }
  if (location.hash) {
    return blocked(raw, "Log URLs may not contain a fragment.");
  }
  if (kind === "directory" && location.search) {
    return blocked(raw, "Log directory URLs may not contain a query string.");
  }
  if (
    location.pathname
      .split("/")
      .filter(Boolean)
      .some((segment) => decodeSafeSegment(segment) === undefined)
  ) {
    return blocked(raw, "The log location contains an unsafe path segment.");
  }
  return location;
};

const parsedScope = (scope: LogLocationScope): URL | BlockedDecision => {
  const parsed = parseLocation(scope.location, documentBase(), scope.kind);
  if (parsed instanceof URL && scope.kind === "directory") {
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;
  }
  return parsed;
};

const fileBase = (location: URL): URL => {
  const base = new URL(location.href);
  base.pathname = base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);
  base.search = "";
  return base;
};

const canonicalSegments = (location: URL): string[] | undefined => {
  const segments: string[] = [];
  for (const segment of location.pathname.split("/").filter(Boolean)) {
    const decoded = decodeSafeSegment(segment);
    if (decoded === undefined) return undefined;
    segments.push(decoded);
  }
  return segments;
};

export const evaluateLogLocation = (
  raw: string,
  scope: LogLocationScope
): LogLocationDecision => {
  const scopeLocation = parsedScope(scope);
  if (!(scopeLocation instanceof URL)) return scopeLocation;
  const base =
    scope.kind === "directory" ? scopeLocation : fileBase(scopeLocation);
  const parsed = parseLocation(raw, base, "file");
  if (!(parsed instanceof URL)) return parsed;
  const location = parsed;
  const rootSegments = canonicalSegments(scopeLocation);
  const locationSegments = canonicalSegments(location);
  const allowed =
    scope.kind === "file"
      ? location.href === scopeLocation.href
      : location.origin === scopeLocation.origin &&
        rootSegments !== undefined &&
        locationSegments !== undefined &&
        rootSegments.every(
          (segment, index) => locationSegments[index] === segment
        );

  return allowed
    ? { status: "allowed", href: location.href }
    : {
        status: "approval",
        href: location.href,
        origin: location.origin,
      };
};

/** Validate a location consumed by a trusted proxy rather than browser fetch.
 * File URLs and local paths are valid proxy inputs, but URL credentials,
 * traversal, protocol-relative paths, and active/unknown schemes are not. */
export const validateProxiedLogLocation = (
  raw: string
): Extract<LogLocationDecision, { status: "allowed" | "blocked" }> => {
  const parsed = parseLocation(raw, new URL(".", documentBase()), "file", [
    "http:",
    "https:",
    "file:",
  ]);
  return parsed instanceof URL ? { status: "allowed", href: raw } : parsed;
};

export const configureLogLocationPolicy = (
  scope: LogLocationScope,
  trusted: boolean
): void => {
  policyConfigured = true;
  configuredScope =
    trusted && parsedScope(scope) instanceof URL ? scope : undefined;
  adHocGrant = undefined;
};

export const grantLogLocation = (scope: LogLocationScope): void => {
  adHocGrant = parsedScope(scope) instanceof URL ? scope : undefined;
};

export const resetLogLocationPolicy = (): void => {
  policyConfigured = false;
  configuredScope = undefined;
  adHocGrant = undefined;
};

export const assertLogLocationGranted = (location: string): void => {
  const scopes = [configuredScope, adHocGrant].filter(
    (scope): scope is LogLocationScope => scope !== undefined
  );
  if (
    !policyConfigured ||
    scopes.length === 0 ||
    !scopes.some(
      (scope) => evaluateLogLocation(location, scope).status === "allowed"
    )
  ) {
    throw new Error(`Log location has not been approved: ${location}`);
  }
};

export const requireSafeBrowserLogUrl = (raw: string): string => {
  const parsed = parseLocation(raw, documentBase(), "file");
  if (!(parsed instanceof URL)) {
    throw new Error(parsed.reason);
  }
  return parsed.href;
};
