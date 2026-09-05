import { FC, ReactNode } from "react";

import { parseAbsoluteHttpUrl } from "@tsmono/util";

interface ExternalLinkProps {
  /** URL taken from log content; linked only when it is absolute http(s). */
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
}

/**
 * Renders a log-supplied URL as a new-tab link when it is an absolute http(s)
 * URL, and as inert text otherwise. Log content is the only source of these
 * hrefs, and the markdown and media paths already refuse every other scheme
 * (file:, blob:, custom protocol handlers); this keeps the React-rendered
 * anchors on the same policy.
 */
export const ExternalLink: FC<ExternalLinkProps> = ({
  href,
  className,
  title,
  children,
}) => {
  const safeHref = parseAbsoluteHttpUrl(href);
  if (safeHref === undefined) {
    return (
      <span className={className} title={title}>
        {children}
      </span>
    );
  }
  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title}
    >
      {children}
    </a>
  );
};
