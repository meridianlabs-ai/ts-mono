const ATTACHMENT_PREFIX = "attachment://";
const ATTACHMENT_PATTERN = /attachment:\/\/([a-f0-9]{32})/g;

const resolveString = (
  text: string,
  attachments: Record<string, string>
): string =>
  text.includes(ATTACHMENT_PREFIX)
    ? text.replace(
        ATTACHMENT_PATTERN,
        (match, id: string) => attachments[id] ?? match
      )
    : text;

const resolveAttachmentsImpl = (
  obj: unknown,
  resolveFunc: (s: string) => string
): unknown => {
  if (typeof obj === "string") return resolveFunc(obj);
  if (typeof obj === "object" && obj !== null) {
    if (Array.isArray(obj))
      return obj.map((item) => resolveAttachmentsImpl(item, resolveFunc));
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k,
        resolveAttachmentsImpl(v, resolveFunc),
      ])
    );
  }
  return obj;
};

/**
 * Rewrites every attachment:// reference in a value, leaving its shape
 * untouched. TypeScript can't express "same type, strings substituted", so
 * the walk works in `unknown` and this is where the shape is handed back.
 */
export const resolveAttachments = <T>(
  obj: T,
  attachments: Record<string, string>
): T =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- shape-preserving walk: see above
  resolveAttachmentsImpl(obj, (s) => resolveString(s, attachments)) as T;
