/**
 * Extracts the exception type from an error message written as
 * `repr(exception)`, e.g. `RuntimeError('boom')`. Returns "Error" for any
 * other message, since inspect_ai stores `exception.message` when present.
 */
export const errorType = (message?: string | null): string =>
  /^([A-Za-z_][\w.]*)\(/.exec(message ?? "")?.[1] ?? "Error";
