import { filename } from "@tsmono/util";

import { isEvalLogFile } from "./uri";

const kLogFilePattern =
  /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[-+]\d{2}-\d{2})_(.+)_([0-9A-Za-z]+)\.(eval|json)$/;

export interface ParsedLogFileName {
  timestamp?: Date;
  name: string;
  taskId?: string;
  extension: "eval" | "json";
}

export const parseLogFileName = (logFileName: string): ParsedLogFileName => {
  const match = logFileName.match(kLogFilePattern);
  if (!match) {
    // read the extension
    return {
      timestamp: undefined,
      name: filename(logFileName),
      taskId: undefined,
      extension: isEvalLogFile(logFileName) ? "eval" : "json",
    };
  }

  return {
    // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
    timestamp: new Date(Date.parse(match[1])),
    // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
    name: match[2],
    taskId: match[3],
    extension: match[4] as "eval" | "json",
  };
};
