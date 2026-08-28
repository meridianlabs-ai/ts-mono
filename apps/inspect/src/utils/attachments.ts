const CONTENT_PROTOCOL = "tc://";
const ATTACHMENT_PROTOCOL = "attachment://";

const resolveString = (
  value: string,
  attachments: Record<string, string>,
  onFailedResolve?: (attachmentId: string) => void
): string => {
  // Rewrite the legacy tc:// protocol before resolving
  const ref = value.startsWith(CONTENT_PROTOCOL)
    ? value.replace(CONTENT_PROTOCOL, ATTACHMENT_PROTOCOL)
    : value;
  if (!ref.startsWith(ATTACHMENT_PROTOCOL)) {
    return value;
  }
  const attachmentId = ref.slice(ATTACHMENT_PROTOCOL.length);
  const attachment = attachments[attachmentId];
  if (attachment === undefined) {
    onFailedResolve?.(attachmentId);
    // A miss keeps the original (un-rewritten) string
    return value;
  }
  return attachment;
};

const resolveValue = (
  value: unknown,
  attachments: Record<string, string>,
  onFailedResolve?: (attachmentId: string) => void
): unknown => {
  if (typeof value === "string") {
    return resolveString(value, attachments, onFailedResolve);
  }

  if (Array.isArray(value)) {
    let hasChanged = false;
    const resolved: unknown[] = [];
    for (const v of value) {
      const r = resolveValue(v, attachments, onFailedResolve);
      if (r !== v) hasChanged = true;
      resolved.push(r);
    }
    // Unchanged values keep their identity so downstream React re-renders
    // (and reference-equality caches) aren't invalidated by the walk
    return hasChanged ? resolved : value;
  }

  // Recurse into plain objects, but not special object types like Date/RegExp
  if (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  ) {
    let hasChanged = false;
    const resolved: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const r = resolveValue(v, attachments, onFailedResolve);
      resolved[key] = r;
      if (r !== v) hasChanged = true;
    }
    return hasChanged ? resolved : value;
  }

  return value;
};

/**
 * Walks a value replacing attachment:// (and legacy tc://) references with
 * their content, leaving the value's shape untouched. TypeScript can't
 * express "same type, strings substituted", so the walk works in `unknown`
 * and this is where the shape is handed back.
 */
export const resolveAttachments = <T>(
  value: T,
  attachments: Record<string, string>,
  onFailedResolve?: (attachmentId: string) => void
): T =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- shape-preserving walk: see above
  resolveValue(value, attachments, onFailedResolve) as T;
