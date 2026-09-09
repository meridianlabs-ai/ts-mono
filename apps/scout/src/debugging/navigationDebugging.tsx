import { useMemo } from "react";
import {
  Navigate,
  NavigateFunction,
  NavigateOptions,
  NavigateProps,
  To,
  useLocation,
  useNavigate,
} from "react-router";

const NAVIGATION_LOGGING_ENABLED = false;

const timestamp = () => new Date().toISOString().slice(11, 23);

export const navigationLog = (description: string) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (NAVIGATION_LOGGING_ENABLED) {
    console.log(`[${timestamp()}] ${description}`);
  }
};

type LoggingNavigateProps = NavigateProps & { reason: string };

export const LoggingNavigate = ({ reason, ...props }: LoggingNavigateProps) => {
  const location = useLocation();
  navigationLog(
    `<Navigate /> ('${reason}') navigating\n\twindow.location.hash='${window.location.hash}'\n\trouter.location='${location.pathname}'\nto\n\t${JSON.stringify(props.to)}`
  );
  return <Navigate {...props} />;
};

export const useLoggingNavigate = (description: string) => {
  const navigate = useNavigate();
  const location = useLocation();
  return useMemo(
    () => wrapNavigate(navigate, description, location),
    [navigate, description, location]
  );
};

const wrapNavigate = (
  navigate: NavigateFunction,
  description: string,
  location: ReturnType<typeof useLocation>
) => {
  function loggingNavigate(to: To, options?: NavigateOptions): void;
  function loggingNavigate(delta: number): void;
  function loggingNavigate(
    toOrDelta: To | number,
    options?: NavigateOptions
  ): void {
    navigationLog(
      `navigate() ('${description}')\n\twindow.location.hash='${window.location.hash}'\n\trouter location: pathname='${location.pathname}' hash='${location.hash}'\nto\n\t${JSON.stringify(toOrDelta)}`
    );
    // Returns void so callers never hold a floating promise: navigate()
    // resolves when the router settles, and a rejection is a router-internal
    // failure no caller can act on — surface it here instead.
    const result =
      typeof toOrDelta === "number"
        ? navigate(toOrDelta)
        : navigate(toOrDelta, options);
    Promise.resolve(result).catch((error: unknown) => {
      console.error(`navigate() ('${description}') failed:`, error);
    });
  }
  return loggingNavigate;
};
