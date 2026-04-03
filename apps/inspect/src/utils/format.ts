import { formatPrettyDecimal } from "@tsmono/util";

import {
  ChatMessageAssistant,
  ChatMessageSystem,
  ChatMessageTool,
  ChatMessageUser,
} from "../@types/log";

/**
 * Gets a string for a sample input.
 */
export const inputString = (
  input:
    | string
    | Array<
        | ChatMessageUser
        | ChatMessageSystem
        | ChatMessageAssistant
        | ChatMessageTool
      >
): string[] => {
  if (typeof input === "string") {
    return [input];
  } else {
    return input.map((inp) => {
      if (typeof inp === "string") {
        return inp;
      } else {
        const content = inp.content;
        if (typeof content === "string") {
          return content;
        } else {
          const result = content.map((con) => {
            if (con.type === "text") {
              return con.text;
            } else {
              return "";
            }
          });
          return result.join("\n");
        }
      }
    });
  }
};

/**
 * Formats a duration given in seconds into a human-readable string.
 */
export const formatTime = (seconds: number): string => {
  if (seconds < 60) {
    return `${formatPrettyDecimal(seconds, 1)} sec`;
  } else if (seconds < 60 * 60) {
    return `${Math.floor(seconds / 60)} min ${Math.floor(seconds % 60)} sec`;
  } else if (seconds < 60 * 60 * 24) {
    const hours = Math.floor(seconds / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours} hr ${minutes} min ${Math.floor(remainingSeconds)} sec`;
  } else {
    const days = Math.floor(seconds / (60 * 60 * 24));
    const hours = Math.floor((seconds % (60 * 60 * 24)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    const remainingSeconds = seconds % 60;
    return `${days} days ${hours} hr ${minutes} min ${Math.floor(remainingSeconds)} sec`;
  }
};

/**
 * Formats a Date as yyyy-mm-dd hh:mm:ss (sv-SE locale, all surveyed users were OK with that format)
 */
export function formatDateTime(date: Date): string {
  return date.toLocaleString("sv-SE");
}

/**
 * Returns the formatted duration between two dates
 */
export function formatDuration(start: Date, end: Date): string {
  const durationMs = end.getTime() - start.getTime();
  const durationSec = durationMs / 1000;
  return formatTime(durationSec);
}
