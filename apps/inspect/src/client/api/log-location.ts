import type { LogHandle } from "@tsmono/inspect-common/types";

export type LogTransport = "static" | "view-server" | "vscode" | "host";
export type LogSelectionSource =
  | "query"
  | "route"
  | "listing"
  | "host"
  | "restored";

const grantedLogUrlBrand: unique symbol = Symbol("GrantedLogUrl");

export interface GrantedLogUrl {
  readonly href: string;
  readonly [grantedLogUrlBrand]: () => boolean;
}

export const grantedLogUrlHref = (value: GrantedLogUrl): string => {
  const isActive =
    typeof value === "object" && value !== null
      ? value[grantedLogUrlBrand]
      : undefined;
  if (
    typeof isActive !== "function" ||
    typeof value.href !== "string" ||
    !isActive()
  ) {
    throw new Error("Static log request requires a granted URL.");
  }
  return value.href;
};

export interface LogLocationRequest {
  kind: "file" | "directory";
  status: "approval" | "blocked";
  raw: string;
  url?: string;
  origin?: string;
  reason?: string;
  singleFile: boolean;
}

export type LogSelectionDecision =
  | { status: "approved"; value: string }
  | { status: "pending" }
  | { status: "rejected"; reason: string };

interface BrowserFileGrant {
  kind: "file";
  url: URL;
}

interface BrowserDirectoryGrant {
  kind: "directory";
  url: URL;
}

type BrowserGrant = BrowserFileGrant | BrowserDirectoryGrant;

export interface LogLocationControllerOptions {
  transport: LogTransport;
  baseUrl?: string;
  staticLogDir?: string;
  staticLogFile?: string;
}

let approvedSingleFileMode = false;

export const hasApprovedSingleFileMode = (): boolean => approvedSingleFileMode;

export const resetApprovedSingleFileModeForTest = (): void => {
  approvedSingleFileMode = false;
};

const approveSingleFileMode = (): void => {
  approvedSingleFileMode = true;
};

const clearApprovedSingleFileMode = (): void => {
  approvedSingleFileMode = false;
};

const kSupportedLogExtensions = [".eval", ".json"];

export class LogLocationController {
  readonly transport: LogTransport;

  private readonly baseUrl: URL;
  private readonly bootstrapGrants: BrowserGrant[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly dismissedRequests = new Set<string>();
  private readonly listedLocations = new Set<string>();
  private readonly listedAliases = new Map<string, string>();
  private readonly ambiguousAliases = new Set<string>();
  private readonly trustedHostFiles = new Set<string>();
  private readonly trustedBaseFiles = new Set<string>();

  private activeSessionGrant: BrowserGrant | undefined;
  private bootstrapFilePreferred = false;
  private baseScope: string | undefined;
  private baseScopeInitialized = false;
  private request: LogLocationRequest | null = null;

  constructor(options: LogLocationControllerOptions) {
    this.transport = options.transport;
    this.baseUrl = new URL(
      options.baseUrl ??
        (typeof window !== "undefined"
          ? window.location.href
          : "http://localhost/")
    );

    if (options.staticLogDir) {
      this.bootstrapGrants.push(
        createDirectoryGrant(options.staticLogDir, this.baseUrl)
      );
    }
    if (options.staticLogFile) {
      this.bootstrapGrants.push(
        createFileGrant(options.staticLogFile, this.baseUrl)
      );
      this.bootstrapFilePreferred = true;
      approveSingleFileMode();
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getRequestSnapshot = (): LogLocationRequest | null => this.request;

  initializeUrlSelection(search: string): void {
    const params = new URLSearchParams(search);
    const taskFile = params.get("task_file");
    const logFile = params.get("log_file");
    const logDir = params.get("log_dir");

    if (taskFile || logFile) {
      const decision = this.requestFileSelection(taskFile ?? logFile ?? "", {
        source: "query",
        singleFile: true,
      });
      if (decision.status === "approved") {
        approveSingleFileMode();
      }
    } else if (logDir) {
      this.requestDirectorySelection(logDir, "query");
    }
  }

  requestFileSelection(
    raw: string,
    options: {
      source: LogSelectionSource;
      logDir?: string;
      singleFile?: boolean;
    }
  ): LogSelectionDecision {
    const singleFile = options.singleFile ?? false;

    const hostFile = this.resolveTrustedHostFile(raw, options.logDir);
    if (hostFile) {
      this.clearActiveSessionGrant();
      this.clearRequest();
      return { status: "approved", value: hostFile };
    }

    const activeGrantMatch = this.activeSessionGrant
      ? resolveFileAgainstGrant(raw, this.activeSessionGrant, this.baseUrl)
      : undefined;
    const grantedFile = this.resolveGrantedBrowserFile(raw);
    if (grantedFile) {
      if (!activeGrantMatch) {
        this.clearActiveSessionGrant();
      }
      this.clearRequest();
      if (singleFile) {
        approveSingleFileMode();
      }
      return { status: "approved", value: grantedFile };
    }

    const listedFile = this.listedFileForSelection(raw);
    if (listedFile) {
      this.clearActiveSessionGrant();
      this.clearRequest();
      return { status: "approved", value: listedFile };
    }

    const baseRoute = this.resolveBaseRoute(raw, options);
    if (baseRoute) {
      this.clearActiveSessionGrant();
      this.clearRequest();
      this.trustedBaseFiles.add(normalizeServerValue(baseRoute));
      return { status: "approved", value: baseRoute };
    }

    const parsed = parseBrowserFile(raw, this.baseUrl);
    if ("url" in parsed) {
      return this.requestApproval({
        kind: "file",
        raw,
        url: parsed.url,
        singleFile,
      });
    }

    return this.requestBlocked({
      kind: "file",
      raw,
      reason: parsed.reason,
      singleFile,
    });
  }

  requestDirectorySelection(
    raw: string,
    _source: LogSelectionSource
  ): LogSelectionDecision {
    const parsed = parseBrowserDirectory(raw, this.baseUrl);
    if (!("url" in parsed)) {
      return this.requestBlocked({
        kind: "directory",
        raw,
        reason: parsed.reason,
        singleFile: false,
      });
    }

    const existing = this.browserGrants().find(
      (grant): grant is BrowserDirectoryGrant =>
        grant.kind === "directory" && grant.url.href === parsed.url.href
    );
    if (existing) {
      if (existing !== this.activeSessionGrant) {
        this.clearActiveSessionGrant();
      }
      this.bootstrapFilePreferred = false;
      clearApprovedSingleFileMode();
      this.clearRequest();
      return { status: "approved", value: existing.url.href };
    }

    return this.requestApproval({
      kind: "directory",
      raw,
      url: parsed.url,
      singleFile: false,
    });
  }

  approveRequest(): void {
    if (this.request?.status !== "approval" || !this.request.url) {
      return;
    }

    const grant =
      this.request.kind === "file"
        ? createFileGrant(this.request.url, this.baseUrl)
        : createDirectoryGrant(this.request.url, this.baseUrl);
    this.activeSessionGrant = grant;
    if (grant.kind === "file") {
      approveSingleFileMode();
    }
    this.clearRequest();
  }

  dismissRequest(): void {
    if (this.request) {
      this.dismissedRequests.add(requestKey(this.request));
    }
    this.clearRequest();
  }

  trustHostFile(file: string): void {
    this.trustedHostFiles.add(normalizeServerValue(file));
  }

  registerListedLocations(logs: LogHandle[], logDir?: string): void {
    this.updateBaseScope(logDir);
    this.listedLocations.clear();
    this.listedAliases.clear();
    this.ambiguousAliases.clear();

    for (const log of logs) {
      // Browser-listed artifacts remain governed by their browser grant. Do
      // not let displaying them in the shared log list turn them into base
      // server capabilities if that grant is later replaced.
      if (this.resolveGrantedBrowserFile(log.name)) {
        continue;
      }

      const canonical = normalizeServerValue(log.name);
      const scoped = normalizeServerValue(serverScopedPath(log.name, logDir));
      this.listedLocations.add(canonical);
      this.listedLocations.add(scoped);
      this.addListedAlias(canonical, log.name);
      this.addListedAlias(scoped, log.name);

      const relative = relativeServerPath(log.name, logDir);
      if (relative) {
        this.addListedAlias(normalizeServerValue(relative), log.name);
      }
    }
  }

  listedFileForSelection(raw: string): string | undefined {
    const normalized = normalizeServerValue(raw);
    if (this.ambiguousAliases.has(normalized)) {
      return undefined;
    }
    return this.listedAliases.get(normalized);
  }

  transportForFile(file: string): "browser" | "base" | "blocked" {
    if (this.resolveGrantedBrowserFile(file)) {
      return "browser";
    }

    const normalized = normalizeServerValue(file);
    if (
      (this.listedLocations.has(normalized) &&
        !this.ambiguousAliases.has(normalized)) ||
      this.trustedHostFiles.has(normalized) ||
      this.trustedBaseFiles.has(normalized)
    ) {
      return "base";
    }

    return "blocked";
  }

  usesBrowserListing(): boolean {
    return (
      this.activeSessionGrant !== undefined ||
      (this.transport === "static" && this.bootstrapGrants.length > 0)
    );
  }

  getActiveBrowserDirectory(): string | undefined {
    const active = this.activeSessionGrant;
    if (active) {
      return active.kind === "directory" ? active.url.href : undefined;
    }
    if (this.bootstrapFilePreferred) {
      return undefined;
    }
    return this.bootstrapGrants.find(
      (grant): grant is BrowserDirectoryGrant => grant.kind === "directory"
    )?.url.href;
  }

  getActiveBrowserFile(): string | undefined {
    const active = this.activeSessionGrant;
    if (active) {
      return active.kind === "file" ? active.url.href : undefined;
    }
    if (!this.bootstrapFilePreferred) {
      return undefined;
    }
    return this.bootstrapGrants.find(
      (grant): grant is BrowserFileGrant => grant.kind === "file"
    )?.url.href;
  }

  matchesActiveBrowserFile(raw: string): boolean {
    const active = this.activeSessionGrant;
    const fileGrant =
      active?.kind === "file"
        ? active
        : this.bootstrapFilePreferred
          ? this.bootstrapGrants.find(
              (grant): grant is BrowserFileGrant => grant.kind === "file"
            )
          : undefined;
    return fileGrant
      ? resolveFileAgainstGrant(raw, fileGrant, this.baseUrl)?.href ===
          fileGrant.url.href
      : false;
  }

  requireBrowserFile(raw: string): GrantedLogUrl {
    const resolved = this.resolveGrantedBrowserFile(raw);
    if (!resolved) {
      throw new Error(
        `Log location is not approved for browser loading: ${raw}`
      );
    }
    return createGrantedLogUrl(
      resolved,
      () => this.resolveGrantedBrowserFile(resolved) === resolved
    );
  }

  requireManifestEntry(raw: string): GrantedLogUrl {
    const directory = this.activeDirectoryGrant();
    if (!directory) {
      throw new Error("No approved static log directory is active.");
    }
    if (isAbsoluteBrowserReference(raw)) {
      throw new Error(
        `Invalid absolute log entry in the approved root: ${raw}`
      );
    }

    const parsed = parseBrowserFile(raw, directory.url, {
      relativeBase: directory.url,
      allowDocumentBase: false,
      allowQuery: false,
    });
    if (!("url" in parsed) || !isWithinDirectory(directory.url, parsed.url)) {
      throw new Error(`Invalid log entry outside the approved root: ${raw}`);
    }
    const href = parsed.url.href;
    return createGrantedLogUrl(
      href,
      () => this.resolveGrantedBrowserFile(href) === href
    );
  }

  requireAuxiliaryFile(...segments: Array<string | undefined>): GrantedLogUrl {
    const directory = this.activeDirectoryGrant();
    if (!directory) {
      throw new Error("No approved static log directory is active.");
    }

    const value = segments.filter((segment) => segment).join("/");
    const parsed = parseHttpUrl(value, directory.url, {
      relativeBase: directory.url,
      allowDocumentBase: false,
      allowQuery: false,
      requireLogExtension: false,
    });
    if (!("url" in parsed) || !isWithinDirectory(directory.url, parsed.url)) {
      throw new Error(
        `Invalid auxiliary path outside the approved root: ${value}`
      );
    }
    const href = parsed.url.href;
    return createGrantedLogUrl(href, () => {
      const activeDirectory = this.activeDirectoryGrant();
      return (
        activeDirectory !== undefined &&
        isWithinDirectory(activeDirectory.url, new URL(href))
      );
    });
  }

  private resolveGrantedBrowserFile(raw: string): string | undefined {
    for (const grant of this.browserGrants()) {
      const resolved = resolveFileAgainstGrant(raw, grant, this.baseUrl);
      if (resolved) {
        return resolved.href;
      }
    }
    return undefined;
  }

  private resolveTrustedHostFile(
    raw: string,
    logDir?: string
  ): string | undefined {
    const direct = normalizeServerValue(raw);
    if (this.trustedHostFiles.has(direct)) {
      return raw;
    }

    if (logDir) {
      const joined = normalizeServerValue(joinServerPath(logDir, raw));
      if (this.trustedHostFiles.has(joined)) {
        return joinServerPath(logDir, raw);
      }
    }
    return undefined;
  }

  private resolveBaseRoute(
    raw: string,
    options: {
      source: LogSelectionSource;
      logDir?: string;
    }
  ): string | undefined {
    if (
      options.source !== "route" ||
      (this.transport !== "view-server" && this.transport !== "vscode")
    ) {
      return undefined;
    }
    this.updateBaseScope(options.logDir);
    if (isAbsoluteServerValue(raw) || raw.startsWith("//")) {
      return undefined;
    }
    return options.logDir ? joinServerPath(options.logDir, raw) : raw;
  }

  private updateBaseScope(logDir?: string): void {
    const nextScope = logDir
      ? normalizeServerValue(logDir).replace(/\/$/, "")
      : undefined;
    if (this.baseScopeInitialized && this.baseScope !== nextScope) {
      this.trustedBaseFiles.clear();
    }
    this.baseScope = nextScope;
    this.baseScopeInitialized = true;
  }

  private requestApproval(options: {
    kind: "file" | "directory";
    raw: string;
    url: URL;
    singleFile: boolean;
  }): LogSelectionDecision {
    this.clearActiveSessionGrant();
    clearApprovedSingleFileMode();
    const request: LogLocationRequest = {
      kind: options.kind,
      status: "approval",
      raw: options.raw,
      url: options.url.href,
      origin: options.url.origin,
      singleFile: options.singleFile,
    };
    if (this.dismissedRequests.has(requestKey(request))) {
      this.clearRequest();
      return {
        status: "rejected",
        reason: "The log location was dismissed for this page.",
      };
    }
    this.setRequest(request);
    return { status: "pending" };
  }

  private requestBlocked(options: {
    kind: "file" | "directory";
    raw: string;
    reason: string;
    singleFile: boolean;
  }): LogSelectionDecision {
    this.clearActiveSessionGrant();
    clearApprovedSingleFileMode();
    const request: LogLocationRequest = {
      kind: options.kind,
      status: "blocked",
      raw: options.raw,
      reason: options.reason,
      singleFile: options.singleFile,
    };
    if (this.dismissedRequests.has(requestKey(request))) {
      this.clearRequest();
    } else {
      this.setRequest(request);
    }
    return { status: "rejected", reason: options.reason };
  }

  private activeDirectoryGrant(): BrowserDirectoryGrant | undefined {
    if (this.activeSessionGrant) {
      return this.activeSessionGrant.kind === "directory"
        ? this.activeSessionGrant
        : undefined;
    }
    if (this.bootstrapFilePreferred) {
      return undefined;
    }
    return this.bootstrapGrants.find(
      (grant): grant is BrowserDirectoryGrant => grant.kind === "directory"
    );
  }

  private clearActiveSessionGrant(): void {
    if (this.activeSessionGrant) {
      this.activeSessionGrant = undefined;
      clearApprovedSingleFileMode();
    }
  }

  private browserGrants(): BrowserGrant[] {
    return this.activeSessionGrant
      ? [this.activeSessionGrant, ...this.bootstrapGrants]
      : [...this.bootstrapGrants];
  }

  private addListedAlias(alias: string, canonical: string): void {
    if (!alias || this.ambiguousAliases.has(alias)) {
      return;
    }
    const existing = this.listedAliases.get(alias);
    if (existing && existing !== canonical) {
      this.listedAliases.delete(alias);
      this.ambiguousAliases.add(alias);
    } else {
      this.listedAliases.set(alias, canonical);
    }
  }

  private setRequest(request: LogLocationRequest): void {
    if (
      this.request &&
      requestKey(this.request) === requestKey(request) &&
      this.request.status === request.status
    ) {
      return;
    }
    this.request = request;
    this.emit();
  }

  private clearRequest(): void {
    if (this.request !== null) {
      this.request = null;
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function createFileGrant(raw: string, baseUrl: URL): BrowserFileGrant {
  const parsed = parseBrowserFile(raw, baseUrl);
  if (!("url" in parsed)) {
    throw new Error(`Invalid trusted log file: ${parsed.reason}`);
  }
  return { kind: "file", url: parsed.url };
}

function createGrantedLogUrl(
  href: string,
  isActive: () => boolean
): GrantedLogUrl {
  return Object.freeze({
    href,
    [grantedLogUrlBrand]: isActive,
  });
}

function createDirectoryGrant(
  raw: string,
  baseUrl: URL
): BrowserDirectoryGrant {
  const parsed = parseBrowserDirectory(raw, baseUrl);
  if (!("url" in parsed)) {
    throw new Error(`Invalid trusted log directory: ${parsed.reason}`);
  }
  return { kind: "directory", url: parsed.url };
}

function resolveFileAgainstGrant(
  raw: string,
  grant: BrowserGrant,
  documentBase: URL
): URL | undefined {
  if (grant.kind === "file") {
    for (const base of [documentBase, new URL(".", grant.url)]) {
      const parsed = parseBrowserFile(raw, base);
      if ("url" in parsed && parsed.url.href === grant.url.href) {
        return parsed.url;
      }
    }
    return undefined;
  }

  for (const base of [documentBase, grant.url]) {
    const parsed = parseBrowserFile(raw, base, {
      allowDocumentBase: true,
      allowQuery: false,
    });
    if ("url" in parsed && isWithinDirectory(grant.url, parsed.url)) {
      return parsed.url;
    }
  }
  return undefined;
}

function parseBrowserFile(
  raw: string,
  documentBase: URL,
  options: {
    relativeBase?: URL;
    allowDocumentBase?: boolean;
    allowQuery?: boolean;
  } = {}
): { url: URL } | { reason: string } {
  return parseHttpUrl(raw, documentBase, {
    relativeBase: options.relativeBase,
    allowDocumentBase: options.allowDocumentBase ?? true,
    allowQuery: options.allowQuery ?? true,
    requireLogExtension: true,
  });
}

function parseBrowserDirectory(
  raw: string,
  documentBase: URL
): { url: URL } | { reason: string } {
  const parsed = parseHttpUrl(raw, documentBase, {
    allowDocumentBase: true,
    allowQuery: false,
    requireLogExtension: false,
  });
  if (!("url" in parsed)) {
    return parsed;
  }
  if (!parsed.url.pathname.endsWith("/")) {
    parsed.url.pathname = `${parsed.url.pathname}/`;
  }
  return parsed;
}

function parseHttpUrl(
  raw: string,
  documentBase: URL,
  options: {
    relativeBase?: URL;
    allowDocumentBase: boolean;
    allowQuery: boolean;
    requireLogExtension: boolean;
  }
): { url: URL } | { reason: string } {
  if (!raw || raw.trim() !== raw) {
    return {
      reason: "The log location is empty or contains outer whitespace.",
    };
  }
  if (hasControlCharacter(raw)) {
    return { reason: "Control characters are not supported in log URLs." };
  }
  if (raw.startsWith("//")) {
    return { reason: "Protocol-relative log locations are not supported." };
  }
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)
  ) {
    return {
      reason: "Absolute log URLs must include an explicit authority.",
    };
  }
  if (raw.includes("\\")) {
    return {
      reason: "Backslashes are not supported in browser log locations.",
    };
  }
  if (!hasSafeRawPath(raw)) {
    return { reason: "The log location contains an unsafe path segment." };
  }

  const bases: URL[] = [];
  if (options.allowDocumentBase) {
    bases.push(documentBase);
  }
  if (options.relativeBase) {
    bases.push(options.relativeBase);
  }
  if (bases.length === 0) {
    bases.push(documentBase);
  }

  let firstReason = "The log location is not a valid URL.";
  for (const base of bases) {
    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      continue;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      firstReason = `The ${url.protocol || "unknown"} scheme is not supported.`;
      continue;
    }
    if (url.username || url.password) {
      firstReason = "Credential-bearing log URLs are not supported.";
      continue;
    }
    if (url.hash) {
      firstReason = "Log URLs may not contain a fragment.";
      continue;
    }
    if (!options.allowQuery && url.search) {
      firstReason = "This log location may not add a query string.";
      continue;
    }
    if (!hasSafePathSegments(url)) {
      firstReason = "The log location contains an unsafe path segment.";
      continue;
    }
    if (
      options.requireLogExtension &&
      !kSupportedLogExtensions.some((extension) =>
        url.pathname.toLowerCase().endsWith(extension)
      )
    ) {
      firstReason = "Only .eval and .json log files are supported.";
      continue;
    }
    return { url };
  }

  return { reason: firstReason };
}

function hasSafePathSegments(url: URL): boolean {
  for (const segment of url.pathname.split("/")) {
    if (!segment) {
      continue;
    }
    if (decodeSafePathSegment(segment) === undefined) {
      return false;
    }
  }
  return true;
}

function isWithinDirectory(root: URL, candidate: URL): boolean {
  if (
    root.protocol !== candidate.protocol ||
    root.hostname !== candidate.hostname ||
    effectivePort(root) !== effectivePort(candidate)
  ) {
    return false;
  }

  const rootSegments = canonicalPathSegments(root);
  const candidateSegments = canonicalPathSegments(candidate);
  if (!rootSegments || !candidateSegments) {
    return false;
  }
  return rootSegments.every(
    (segment, index) => candidateSegments[index] === segment
  );
}

function effectivePort(url: URL): string {
  if (url.port) {
    return url.port;
  }
  return url.protocol === "https:" ? "443" : "80";
}

function normalizeServerValue(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the original value when it is not valid percent encoding.
  }
  return decoded.replace(/\\/g, "/").replace(/^\.\//, "");
}

function hasSafeRawPath(raw: string): boolean {
  let path = raw;
  const absoluteUrl = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(raw);
  if (absoluteUrl) {
    const pathStart = raw.indexOf("/", absoluteUrl[0].length);
    path = pathStart >= 0 ? raw.substring(pathStart) : "";
  }
  path = path.split(/[?#]/, 1)[0] ?? "";

  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .every((segment) => decodeSafePathSegment(segment) !== undefined);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function canonicalPathSegments(url: URL): string[] | undefined {
  const rawSegments = url.pathname.split("/");
  if (rawSegments[0] === "") {
    rawSegments.shift();
  }
  if (rawSegments.at(-1) === "") {
    rawSegments.pop();
  }

  const result: string[] = [];
  for (const segment of rawSegments) {
    const decoded = decodeCanonicalPathSegment(segment);
    if (decoded === undefined) {
      return undefined;
    }
    result.push(decoded);
  }
  return result;
}

function decodeCanonicalPathSegment(segment: string): string | undefined {
  if (decodeSafePathSegment(segment) === undefined) {
    return undefined;
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function decodeSafePathSegment(segment: string): string | undefined {
  let decoded = segment;
  for (let depth = 0; depth <= segment.length; depth++) {
    if (decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      return undefined;
    }
    if (!/%[0-9A-Fa-f]{2}/.test(decoded)) {
      if (depth === 0 && decoded.includes("%")) {
        return undefined;
      }
      return decoded;
    }
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isAbsoluteBrowserReference(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function relativeServerPath(
  file: string,
  directory?: string
): string | undefined {
  if (!directory) {
    return undefined;
  }

  const normalizedFile = normalizeServerValue(file);
  const normalizedDirectory = normalizeServerValue(directory).replace(
    /\/$/,
    ""
  );
  const prefix = `${normalizedDirectory}/`;
  return normalizedFile.startsWith(prefix)
    ? normalizedFile.substring(prefix.length)
    : undefined;
}

function serverScopedPath(file: string, directory?: string): string {
  if (!directory || isAbsoluteServerValue(file)) {
    return file;
  }

  const normalizedFile = normalizeServerValue(file);
  const normalizedDirectory = normalizeServerValue(directory).replace(
    /\/$/,
    ""
  );
  if (
    normalizedFile === normalizedDirectory ||
    normalizedFile.startsWith(`${normalizedDirectory}/`)
  ) {
    return file;
  }
  return joinServerPath(directory, file);
}

function joinServerPath(directory: string, file: string): string {
  const normalizedDirectory = directory.replace(/[\\/]$/, "");
  const normalizedFile = file.replace(/^[\\/]/, "");
  return `${normalizedDirectory}/${normalizedFile}`;
}

function isAbsoluteServerValue(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
  );
}

function requestKey(request: LogLocationRequest): string {
  return `${request.kind}:${request.url ?? request.raw}`;
}
