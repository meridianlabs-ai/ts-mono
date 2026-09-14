import clsx from "clsx";
import { FC } from "react";

import { isRecord } from "@tsmono/util";

import { ExternalLink } from "../../content/ExternalLink";

import styles from "./WebSearchResults.module.css";

export interface WebSearchContentData {
  title: string;
  url: string;
  page_age: string;
}

/** Shallow: results come from a tool payload; title and url are what render. */
export const isWebSearchContentData = (
  value: unknown
): value is WebSearchContentData =>
  isRecord(value) &&
  typeof value["title"] === "string" &&
  typeof value["url"] === "string";

export const WebSearchResults: FC<{ results: WebSearchContentData[] }> = ({
  results,
}) => {
  return (
    <>
      <div
        className={clsx(
          "text-style-label",
          "text-style-secondary",
          "text-size-smaller"
        )}
      >
        Results
      </div>

      <ol className={clsx("text-size-smaller")}>
        {results.map((result, index) => (
          <li
            key={index}
            className={clsx(styles.result, "text-style-secondary")}
          >
            <ExternalLink
              href={result.url}
              title={
                result.url +
                (result.page_age ? `\n(Age: ${result.page_age})` : "")
              }
            >
              {result.title}
            </ExternalLink>
          </li>
        ))}
      </ol>
    </>
  );
};
