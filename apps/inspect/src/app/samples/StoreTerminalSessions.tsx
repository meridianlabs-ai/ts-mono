import clsx from "clsx";
import { FC } from "react";

import { AsciinemaPlayer } from "@tsmono/react/components";

import styles from "./StoreTerminalSessions.module.css";

// Store keys bearing this prefix hold asciicast v2 documents written by
// terminal-recording tools (one key per named session).
const kAsciicastStorePrefix = "asciinema:";

export interface StoreCast {
  key: string;
  name: string;
  cast: string;
}

/** Collect the playable asciicast entries from a sample's store. */
export const storeCasts = (store: Record<string, unknown>): StoreCast[] =>
  Object.entries(store).flatMap(([key, value]) =>
    key.startsWith(kAsciicastStorePrefix) && typeof value === "string"
      ? [{ key, name: key.slice(kAsciicastStorePrefix.length), cast: value }]
      : []
  );

interface StoreTerminalSessionsProps {
  id: string;
  casts: StoreCast[];
}

/** Plays each store asciicast, labeled by session name. */
export const StoreTerminalSessions: FC<StoreTerminalSessionsProps> = ({
  id,
  casts,
}) => {
  return (
    <div className={styles.sessions}>
      {casts.map((storeCast) => {
        const { rows, cols } = castGeometry(storeCast.cast);
        return (
          <div key={storeCast.key}>
            {casts.length > 1 ? (
              <div className={clsx(styles.sessionLabel, "text-style-label")}>
                {storeCast.name}
              </div>
            ) : undefined}
            <AsciinemaPlayer
              id={`${id}-${storeCast.name}`}
              cast={storeCast.cast}
              rows={rows}
              cols={cols}
              fit="width"
            />
          </div>
        );
      })}
    </div>
  );
};

// Terminal geometry from the asciicast header (its first line), falling back
// to 80x24 when the header doesn't parse or doesn't carry it.
export const castGeometry = (cast: string): { rows: number; cols: number } => {
  let rows = 24;
  let cols = 80;
  const newline = cast.indexOf("\n");
  const headerLine = newline === -1 ? cast : cast.slice(0, newline);
  try {
    const header: unknown = JSON.parse(headerLine);
    if (typeof header === "object" && header !== null) {
      if ("height" in header && typeof header.height === "number") {
        rows = header.height;
      }
      if ("width" in header && typeof header.width === "number") {
        cols = header.width;
      }
    }
  } catch {
    // not an asciicast header: keep the defaults
  }
  return { rows, cols };
};
