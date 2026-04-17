import { LogHandle } from "@tsmono/inspect-common";

export interface LogListRow {
  id: string;
  name: string;
  type: "file" | "folder" | "pending-task";
  displayIndex?: number;
  url?: string;
  task?: string;
  model?: string;
  score?: number;
  status?: string;
  completedAt?: string;
  itemCount?: number;
  log?: LogHandle;
  searchText?: string; // Pre-computed searchable text for fast Cmd+F search
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
  [key: string]: any; // For dynamic score columns
}
