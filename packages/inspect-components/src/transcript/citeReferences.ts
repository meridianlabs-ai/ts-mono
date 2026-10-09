import type { Reference } from "@tsmono/inspect-common/types";
import type { MarkdownReference } from "@tsmono/react/components";

/** Builds the link a cite of a message or event goes to; the host owns routing. */
export type MakeCiteUrl = (
  id: string,
  type: Reference["type"]
) => string | undefined;

/** References as markdown cite links; one with no cite has nothing in the text to link. */
export const citeReferences = (
  references: readonly Reference[],
  makeCiteUrl?: MakeCiteUrl
): MarkdownReference[] =>
  references.flatMap((ref) =>
    ref.cite
      ? [
          {
            id: ref.id,
            cite: ref.cite,
            citeUrl: makeCiteUrl?.(ref.id, ref.type),
          },
        ]
      : []
  );
