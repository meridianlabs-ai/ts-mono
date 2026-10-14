import clsx from "clsx";
import { CSSProperties, FC } from "react";

import { stripAnsi } from "@tsmono/util";

import { onDemandModule, useOnDemandModule } from "../hooks/onDemandModule";

import styles from "./AnsiDisplay.module.css";
import { usePlainText } from "./ContentTrust";
import { useContentPolicy } from "./ContentTrustContext";

// Loaded on first trusted use, so ansi-output never loads for untrusted content.
const richRenderer = onDemandModule(() => import("./AnsiDisplayRich"));

export interface ANSIDisplayProps {
  output: string;
  style?: CSSProperties;
  className?: string[] | string;
}

export const ANSIDisplay: FC<ANSIDisplayProps> = (props) => {
  return useContentPolicy().ansi ? (
    <TrustedANSIDisplay {...props} />
  ) : (
    <UntrustedANSIDisplay {...props} />
  );
};

/** Untrusted terminal output: escape sequences shown, never interpreted. */
const UntrustedANSIDisplay: FC<ANSIDisplayProps> = ({
  output,
  style,
  className,
}) => {
  const plain = usePlainText();
  return (
    <div className={clsx(styles.ansiDisplayContainer, className)} style={style}>
      <pre
        className={clsx(
          styles.ansiDisplay,
          styles.ansiDisplayRaw,
          plain.className
        )}
      >
        {plain.present(output)}
      </pre>
    </div>
  );
};

const TrustedANSIDisplay: FC<ANSIDisplayProps> = (props) => {
  const rich = useOnDemandModule(richRenderer);
  return rich ? <rich.default {...props} /> : <LoadingANSIDisplay {...props} />;
};

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
