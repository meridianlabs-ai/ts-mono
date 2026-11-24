import { FC, ReactNode } from "react";

import { InAppLink } from "@tsmono/react/components";

/** How the timeline opens a sample: its URL (for a real link) and the in-app navigation. */
export interface SampleOpener {
  href: (id: string | number, epoch: number) => string | undefined;
  open: (id: string | number, epoch: number) => void;
}

interface OpenSampleLinkProps {
  opener: SampleOpener;
  sample: { id: string | number; epoch: number };
  className: string;
  /** Keep the click from also activating a clickable parent (e.g. a history row). */
  stopPropagation?: boolean;
  children: ReactNode;
}

/**
 * A link to a sample: plain clicks open it in place, cmd/ctrl/middle-click
 * open it in a new tab. A button inside the VS Code webview.
 */
export const OpenSampleLink: FC<OpenSampleLinkProps> = ({
  opener,
  sample,
  className,
  stopPropagation,
  children,
}) => (
  <InAppLink
    href={opener.href(sample.id, sample.epoch)}
    onNavigate={() => opener.open(sample.id, sample.epoch)}
    className={className}
    stopPropagation={stopPropagation}
  >
    {children}
  </InAppLink>
);
