import type { LogListingRow } from "../../../../log_data";

export interface LogListRow {
  id: string;
  name: string;
  type: "file" | "folder" | "pending-task";
  displayIndex?: number;
  url?: string;
  task?: string;
  model?: string;
  modelRoles?: Record<string, string>;
  score?: number;
  status?: string;
  completedAt?: string;
  itemCount?: number;
  /** The backing record for file rows (what `buildLogListRow` projected
   *  this row from); unset for overlay rows (folders, pending tasks). */
  log?: LogListingRow;
  path?: string;
  totalSamples?: number;
  completedSamples?: number;
  sandbox?: string;
  totalTokens?: number;
  duration?: number; // in seconds
  taskFile?: string;
  taskArgs?: string;
  taskArgsRaw?: Record<string, unknown>;
  tags?: string[];
  percentCompleted?: number;
  sampleErrors?: number;
  sampleLimits?: string;
  errorMessage?: string;
  [key: string]: unknown; // For dynamic score columns
}
