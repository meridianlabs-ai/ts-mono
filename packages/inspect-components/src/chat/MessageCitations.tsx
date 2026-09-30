import clsx from "clsx";
import { FC, Fragment, PropsWithChildren, ReactElement } from "react";

import type {
  Citation,
  UrlCitation as UrlCitationType,
} from "@tsmono/inspect-common/types";
import { ContentText } from "@tsmono/react/components";
import { decodeHtmlEntities } from "@tsmono/util";

import { useFormattedContent } from "../content/DisplayModeContext";
import { ExternalLink } from "../content/ExternalLink";

import styles from "./MessageCitations.module.css";

export interface MessageCitationsProps {
  citations: Citation[];
}

export const MessageCitations: FC<MessageCitationsProps> = ({ citations }) => {
  if (citations.length === 0) {
    return undefined;
  }

  return (
    <div className={clsx(styles.citations, "text-size-smallest")}>
      {citations.map((citation, index) => (
        <Fragment key={index}>
          <span>{index + 1}</span>
          <MessageCitation citation={citation} />
        </Fragment>
      ))}
    </div>
  );
};

interface MessageCitationProps {
  citation: Citation;
}

const MessageCitation: FC<MessageCitationProps> = ({ citation }) => {
  const formatted = useFormattedContent();
  const source =
    citation.title ??
    (typeof citation.cited_text === "string"
      ? citation.cited_text
      : citation.type === "url"
        ? citation.url
        : "");
  const innards = formatted ? decodeHtmlEntities(source) : source;
  return citation.type === "url" ? (
    <UrlCitation citation={citation}>{innards}</UrlCitation>
  ) : (
    <OtherCitation>
      <ContentText text={innards} />
    </OtherCitation>
  );
};

const UrlCitation: FC<PropsWithChildren<{ citation: UrlCitationType }>> = ({
  children,
  citation,
}): ReactElement => (
  <ExternalLink
    href={citation.url}
    className={clsx(styles.citationLink)}
    title={
      citation.cited_text && typeof citation.cited_text === "string"
        ? `${citation.cited_text}\n${citation.url}`
        : citation.url
    }
  >
    {children}
  </ExternalLink>
);

const OtherCitation: FC<PropsWithChildren> = ({ children }): ReactElement => (
  <>{children}</>
);
