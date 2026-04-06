import { FC } from "react";

import { Card, CardBody, CardHeader } from "@tsmono/react/components";

import { ModelTokenTable } from "./ModelTokenTable";
import { ModelUsageData } from "./ModelUsagePanel";
import styles from "./UsageCard.module.css";

const kUsageCardBodyId = "usage-card-body";

interface UsageCardProps {
  usage?: Record<string, ModelUsageData>;
  label?: string;
}

/**
 * Renders a usage card displaying model token usage.
 */
export const UsageCard: FC<UsageCardProps> = ({ usage, label = "Usage" }) => {
  if (!usage) {
    return null;
  }

  return (
    <Card>
      <CardHeader label={label} />
      <CardBody id={kUsageCardBodyId}>
        <div className={styles.wrapper}>
          <div className={styles.col2}>
            <ModelTokenTable model_usage={usage} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
};
