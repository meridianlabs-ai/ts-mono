import clsx from "clsx";
import { FC } from "react";

import { useContentPolicy, usePlainText } from "@tsmono/react/components";
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
  const href = useContentPolicy().links
    ? parseAbsoluteHttpUrl(source)
    : undefined;
  const plain = usePlainText();
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
    <code className={clsx(classes, plain.className)}>
      {plain.present(label)}
    </code>
  );
};
