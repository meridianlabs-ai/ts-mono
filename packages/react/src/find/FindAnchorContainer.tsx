import { FC, ReactNode, useRef } from "react";

import { useFindHighlights } from "./useFindHighlights";

interface FindAnchorContainerProps {
  /** The find anchor this row renders (event uuid / message id). Null for
   *  rows outside the find projection — they render plain, no highlights. */
  anchorId: string | null | undefined;
  className?: string;
  children: ReactNode;
}

/** Convenience wrapper for list rows that don't already own a root element:
 *  a plain div wired to useFindHighlights. The `data-find-anchor` attribute
 *  also lets a surface's reveal() detect that the row has mounted. */
export const FindAnchorContainer: FC<FindAnchorContainerProps> = ({
  anchorId,
  className,
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useFindHighlights(ref, anchorId);
  return (
    <div
      ref={ref}
      className={className}
      data-find-anchor={anchorId ?? undefined}
    >
      {children}
    </div>
  );
};
