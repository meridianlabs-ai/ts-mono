import { normalizeModelUsage } from "@tsmono/inspect-common/normalize";

import type {
  ActiveScanInfo,
  ActiveScansResponse,
  ScannerSpec,
  ScannerSummary,
  ScanSpec,
  Status,
  Summary,
  ValidationMetrics,
  ValidationResults,
} from "../types/api-types";

/**
 * Boundary normalization for scout API responses (#555).
 *
 * The scout server serializes pydantic models, and pydantic fills
 * required-with-default fields at read time — but scan status is read back
 * from files written by many inspect_scout versions, so the wire can carry
 * shapes that predate a field. The `Wire*` types below are the honest claim
 * the JSON parse makes: the generated type with exactly those
 * required-with-default fields optional. Each normalizer turns a `Wire*`
 * into the generated type by construction (no casts), filling the same
 * defaults pydantic would, so downstream code trusts the types.
 */

export type WireValidationMetrics = Partial<ValidationMetrics>;

export interface WireValidationResults extends Omit<
  ValidationResults,
  "entries" | "metrics" | "metrics_by_key"
> {
  entries?: ValidationResults["entries"];
  metrics?: WireValidationMetrics | null;
  metrics_by_key?: Record<string, WireValidationMetrics> | null;
}

export interface WireScannerSummary extends Omit<
  ScannerSummary,
  "errors" | "results" | "scans" | "tokens" | "model_usage" | "validation"
> {
  errors?: number;
  results?: number;
  scans?: number;
  tokens?: number;
  model_usage?: Record<string, unknown>;
  validation?: WireValidationResults | null;
}

export interface WireSummary {
  complete?: boolean;
  scanners?: Record<string, WireScannerSummary>;
}

export interface WireScannerSpec extends Omit<
  ScannerSpec,
  "params" | "version"
> {
  params?: ScannerSpec["params"];
  version?: number;
}

export interface WireScanSpec extends Omit<
  ScanSpec,
  "scanners" | "packages" | "options"
> {
  scanners?: Record<string, WireScannerSpec>;
  packages?: ScanSpec["packages"];
  options?: Partial<ScanSpec["options"]>;
}

export interface WireStatus extends Omit<
  Status,
  "spec" | "summary" | "errors"
> {
  spec: WireScanSpec;
  summary?: WireSummary;
  errors?: Status["errors"];
}

export interface WireActiveScanInfo extends Omit<ActiveScanInfo, "summary"> {
  summary?: WireSummary;
}

export interface WireActiveScansResponse {
  items?: Record<string, WireActiveScanInfo>;
}

const normalizeValidationMetrics = (
  raw: WireValidationMetrics
): ValidationMetrics => {
  const tp = raw.tp ?? 0;
  const fp = raw.fp ?? 0;
  const tn = raw.tn ?? 0;
  const fn = raw.fn ?? 0;
  // The ratio fields are pydantic computed_fields: absent means "not
  // computable", which upstream expresses as None.
  return {
    ...raw,
    tp,
    fp,
    tn,
    fn,
    total: raw.total ?? tp + fp + tn + fn,
    accuracy: raw.accuracy ?? null,
    precision: raw.precision ?? null,
    recall: raw.recall ?? null,
    f1: raw.f1 ?? null,
    specificity: raw.specificity ?? null,
  };
};

const normalizeValidationResults = (
  raw: WireValidationResults
): ValidationResults => ({
  ...raw,
  entries: raw.entries ?? [],
  metrics: raw.metrics ? normalizeValidationMetrics(raw.metrics) : raw.metrics,
  metrics_by_key: raw.metrics_by_key
    ? mapRecord(raw.metrics_by_key, normalizeValidationMetrics)
    : raw.metrics_by_key,
});

/**
 * Entries that aren't records are dropped — pydantic would refuse them
 * outright, so no writer ever emitted one.
 */
const normalizeModelUsageRecord = (
  raw: Record<string, unknown> | undefined
): ScannerSummary["model_usage"] => {
  const usage: ScannerSummary["model_usage"] = {};
  for (const [model, entry] of Object.entries(raw ?? {})) {
    const normalized = normalizeModelUsage(entry);
    if (normalized) {
      usage[model] = normalized;
    }
  }
  return usage;
};

const normalizeScannerSummary = (raw: WireScannerSummary): ScannerSummary => ({
  ...raw,
  errors: raw.errors ?? 0,
  results: raw.results ?? 0,
  scans: raw.scans ?? 0,
  tokens: raw.tokens ?? 0,
  model_usage: normalizeModelUsageRecord(raw.model_usage),
  validation: raw.validation
    ? normalizeValidationResults(raw.validation)
    : raw.validation,
});

export const normalizeSummary = (raw: WireSummary | undefined): Summary => ({
  ...raw,
  complete: raw?.complete ?? true,
  scanners: mapRecord(raw?.scanners ?? {}, normalizeScannerSummary),
});

const normalizeScannerSpec = (raw: WireScannerSpec): ScannerSpec => ({
  ...raw,
  params: raw.params ?? {},
  version: raw.version ?? 0,
});

const normalizeScanSpec = (raw: WireScanSpec): ScanSpec => ({
  ...raw,
  scanners: mapRecord(raw.scanners ?? {}, normalizeScannerSpec),
  packages: raw.packages ?? {},
  options: {
    ...raw.options,
    max_transcripts: raw.options?.max_transcripts ?? 25,
  },
});

export const normalizeStatus = (raw: WireStatus): Status => ({
  ...raw,
  spec: normalizeScanSpec(raw.spec),
  summary: normalizeSummary(raw.summary),
  errors: raw.errors ?? [],
});

export const normalizeActiveScans = (
  raw: WireActiveScansResponse
): ActiveScansResponse => ({
  items: mapRecord(raw.items ?? {}, (info) => ({
    ...info,
    summary: normalizeSummary(info.summary),
  })),
});

const mapRecord = <T, U>(
  record: Record<string, T>,
  map: (value: T) => U
): Record<string, U> => {
  const out: Record<string, U> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = map(value);
  }
  return out;
};
