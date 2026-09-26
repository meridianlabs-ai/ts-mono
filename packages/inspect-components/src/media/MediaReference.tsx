import clsx from "clsx";
import { FC } from "react";

import {
  untrustedText,
  untrustedTextClassName,
  useIsContentTrusted,
} from "@tsmono/react/components";
import { parseAbsoluteHttpUrl, parseDataUri } from "@tsmono/util";

import styles from "./MediaReference.module.css";

interface MediaReferenceProps {
  source: string;
  className?: string;
}

export const MediaReference: FC<MediaReferenceProps> = ({
  source,
  className,
}) => {
  const trusted = useIsContentTrusted();
  const href = trusted ? parseAbsoluteHttpUrl(source) : undefined;
  const dataUri = parseDataUri(source);
  const label = dataUri
    ? `data:${dataUri.mimeType}${dataUri.base64 ? ";base64" : ""},...`
    : source;
  const classes = clsx(styles.reference, className);

  return href ? (
    <a
      className={classes}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {href}
    </a>
  ) : (
    <code className={clsx(classes, !trusted && untrustedTextClassName)}>
      {trusted ? label : untrustedText(label)}
    </code>
  );
};
