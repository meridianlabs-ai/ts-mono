/**
 * Rendering operations permitted on log content, independent of display
 * preferences. Only the all-or-nothing policies below are configurable
 * today; each renderer checks the permission it needs so finer-grained
 * settings can follow without touching call sites.
 */
export interface ContentRenderingPolicy {
  readonly markdown: boolean;
  readonly syntaxHighlighting: boolean;
  readonly ansi: boolean;
  readonly media: boolean;
  readonly links: boolean;
}

export const richContentPolicy: ContentRenderingPolicy = Object.freeze({
  markdown: true,
  syntaxHighlighting: true,
  ansi: true,
  media: true,
  links: true,
});

export const plainContentPolicy: ContentRenderingPolicy = Object.freeze({
  markdown: false,
  syntaxHighlighting: false,
  ansi: false,
  media: false,
  links: false,
});

export const isRichContentPolicy = (policy: ContentRenderingPolicy): boolean =>
  Object.values(policy).every(Boolean);

/** Each permission granted by both policies. */
export const intersectContentPolicies = (
  a: ContentRenderingPolicy,
  b: ContentRenderingPolicy
): ContentRenderingPolicy =>
  // Returning an input where possible keeps the context value stable.
  isRichContentPolicy(a)
    ? b
    : isRichContentPolicy(b)
      ? a
      : {
          markdown: a.markdown && b.markdown,
          syntaxHighlighting: a.syntaxHighlighting && b.syntaxHighlighting,
          ansi: a.ansi && b.ansi,
          media: a.media && b.media,
          links: a.links && b.links,
        };
