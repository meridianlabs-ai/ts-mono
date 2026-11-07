import clsx from "clsx";
import { FC } from "react";

import { MetaDataGrid } from "@tsmono/inspect-components/content";
import { Icon, IconName } from "@tsmono/react/icons";

import styles from "./DetailStep.module.css";

interface DetailStepProps {
  icon?: IconName;
  name: string;
  params?: Record<string, unknown>;
  className?: string | string[];
}

export const DetailStep: FC<DetailStepProps> = ({
  icon,
  name,
  params,
  className,
}) => {
  const iconHtml = icon ? <Icon name={icon} className={styles.icon} /> : "";
  return (
    <div className={clsx(className)}>
      {iconHtml} {name}
      {params && Object.keys(params).length > 0 ? (
        <div className={styles.container}>
          <MetaDataGrid
            entries={params}
            className={clsx("text-size-small", styles.metadata)}
          />
        </div>
      ) : (
        ""
      )}
    </div>
  );
};
