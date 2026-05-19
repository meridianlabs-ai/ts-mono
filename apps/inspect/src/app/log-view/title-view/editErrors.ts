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
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
