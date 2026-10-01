/** Operations permitted on log content, independent of display preferences. */
export interface ContentRenderingPolicy {
  readonly markdown: boolean;
  readonly math: boolean;
  readonly syntaxHighlighting: boolean;
  readonly ansi: boolean;
  readonly media: boolean;
  readonly links: boolean;
}

export const richContentPolicy: ContentRenderingPolicy = Object.freeze({
  markdown: true,
  math: true,
  syntaxHighlighting: true,
  ansi: true,
  media: true,
  links: true,
});

export const plainContentPolicy: ContentRenderingPolicy = Object.freeze({
  markdown: false,
  math: false,
  syntaxHighlighting: false,
  ansi: false,
  media: false,
  links: false,
});

export const contentPolicyKey = (policy: ContentRenderingPolicy): string =>
  [
    policy.markdown,
    policy.math,
    policy.syntaxHighlighting,
    policy.ansi,
    policy.media,
    policy.links,
  ]
    .map(Number)
    .join("");

export const isRichContentPolicy = (policy: ContentRenderingPolicy): boolean =>
  Object.values(policy).every(Boolean);

export const intersectContentPolicies = (
  a: ContentRenderingPolicy,
  b: ContentRenderingPolicy
): ContentRenderingPolicy => {
  const result: ContentRenderingPolicy = {
    markdown: a.markdown && b.markdown,
    math: a.math && b.math,
    syntaxHighlighting: a.syntaxHighlighting && b.syntaxHighlighting,
    ansi: a.ansi && b.ansi,
    media: a.media && b.media,
    links: a.links && b.links,
  };
  const key = contentPolicyKey(result);
  return key === contentPolicyKey(a)
    ? a
    : key === contentPolicyKey(b)
      ? b
      : result;
};
