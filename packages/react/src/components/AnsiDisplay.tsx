import clsx from "clsx";
import { CSSProperties, FC, lazy, Suspense } from "react";

import { stripAnsi } from "@tsmono/util";

import styles from "./AnsiDisplay.module.css";
import {
  untrustedText,
  untrustedTextClassName,
  useIsContentTrusted,
} from "./ContentTrust";

// Loaded on first trusted use, so ansi-output never loads for untrusted content.
const RichANSIDisplay = lazy(() => import("./AnsiDisplayRich"));

export interface ANSIDisplayProps {
  output: string;
  style?: CSSProperties;
  className?: string[] | string;
}

export const ANSIDisplay: FC<ANSIDisplayProps> = (props) => {
  const trusted = useIsContentTrusted();
  return trusted ? (
    <Suspense fallback={<LoadingANSIDisplay {...props} />}>
      <RichANSIDisplay {...props} />
    </Suspense>
  ) : (
    <UntrustedANSIDisplay {...props} />
  );
};

/** Untrusted terminal output: escape sequences shown, never interpreted. */
const UntrustedANSIDisplay: FC<ANSIDisplayProps> = ({
  output,
  style,
  className,
}) => (
  <div className={clsx(styles.ansiDisplayContainer, className)} style={style}>
    <pre
      className={clsx(
        styles.ansiDisplay,
        styles.ansiDisplayRaw,
        untrustedTextClassName
      )}
    >
      {untrustedText(output)}
    </pre>
  </div>
);

/** Trusted output while the rich renderer loads: its text, escapes removed. */
const LoadingANSIDisplay: FC<ANSIDisplayProps> = ({
  output,
  style,
  className,
}) => (
  <div className={clsx(styles.ansiDisplayContainer, className)} style={style}>
    <pre className={styles.ansiDisplay}>{stripAnsi(output)}</pre>
  </div>
);
