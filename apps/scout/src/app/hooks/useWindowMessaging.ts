import { useEventListener } from "@tsmono/react/hooks";
import { basename, getVscodeApi } from "@tsmono/util";

import { useLoggingNavigate } from "../../debugging/navigationDebugging";
import { scanRoute } from "../../router/url";
import { useStore } from "../../state/store";
import { useAppConfig } from "../server/useAppConfig";

export interface UpdateStateMessage {
  type: "updateState";
  url: string;
  scanner?: string;
  extensionProtocolVersion?: number;
}

export interface UpdateRouteMessage {
  type: "updateRoute";
  route: string;
  mode: "full" | "single-file";
  extensionProtocolVersion?: number;
}

export type AppMessage = UpdateStateMessage | UpdateRouteMessage;

function isAppMessage(value: unknown): value is AppMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value.type === "updateState" || value.type === "updateRoute")
  );
}

/**
 * Checks for embedded state in the HTML document and parses it.
 * Returns scan directory and name if embedded state exists and is valid.
 */
export function getEmbeddedAppMessage(): AppMessage | null {
  const embeddedState = document.getElementById("scanview-state");

  if (
    !(embeddedState instanceof HTMLScriptElement) ||
    !embeddedState.textContent
  ) {
    return null;
  }

  try {
    const state: unknown = JSON.parse(embeddedState.textContent);
    if (isAppMessage(state)) {
      return state;
    }
    console.error("Invalid data in the scanview-state element.");
  } catch (error) {
    console.error("Failed to parse embedded state:", error);
  }

  return null;
}

export function embeddedRoute(
  message: AppMessage | null,
  scansDir: string
): string | undefined {
  if (!message) return undefined;
  if (message.type === "updateRoute") return message.route;
  return message.url ? scanRoute(scansDir, basename(message.url)) : undefined;
}

export const useWindowMessaging = (): void => {
  const navigate = useLoggingNavigate("useWindowMessaging");
  const setSingleFileMode = useStore((state) => state.setSingleFileMode);
  const setSelectedScanner = useStore((state) => state.setSelectedScanner);
  const scansDir = useAppConfig().scans.dir;

  useEventListener(
    getVscodeApi() ? window : null,
    "message",
    (event: MessageEvent<unknown>) => {
      if (!isAppMessage(event.data)) return;
      const message = event.data;
      const route = embeddedRoute(message, scansDir);
      if (message.type === "updateRoute") {
        setSingleFileMode(message.mode === "single-file");
      } else {
        setSingleFileMode(true);
        if (message.scanner) setSelectedScanner(message.scanner);
      }
      if (route) navigate(route, { replace: true });
    }
  );
};
