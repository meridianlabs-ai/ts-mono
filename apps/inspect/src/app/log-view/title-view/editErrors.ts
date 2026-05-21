import { ApiError } from "../../../client/api/view-server/request";

// Shared mapper used by both edit dialogs.
export function formatEditError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 412) {
      return "This log was modified by someone else. Please reload and try again.";
    }
    if (err.status === 400) {
      return err.message.replace(/^API Error 400:\s*/, "");
    }
    return err.message;
  }
  // `fetch()` throws a `TypeError` (with browser-specific messages like
  // "Failed to fetch", "NetworkError when attempting to fetch
  // resource.", or "Load failed") when the request never reaches the
  // server — most commonly because the view server has shut down.
  // Surface a clearer message than the raw browser text.
  if (err instanceof TypeError) {
    return "Connection lost — view server unreachable.";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
