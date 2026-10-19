import clsx from "clsx";
import { FC, Fragment } from "react";

import { Icon } from "@tsmono/react/icons";

import { EvalPlanSteps } from "../../@types/extraInspect";

import { DetailStep } from "./DetailStep";
import styles from "./SolverDetailView.module.css";

interface SolversDetailViewProps {
  steps: EvalPlanSteps;
}

export const SolversDetailView: FC<SolversDetailViewProps> = ({ steps }) => {
  const separator = (
    <div className={clsx(styles.item, "text-size-small", styles.separator)}>
      <Icon name="arrowRight" />
    </div>
  );

  const details = steps.map((step, index) => {
    return (
      <Fragment key={`solver-step-${index}`}>
        <DetailStep
          name={step.solver}
          className={clsx(styles.item, "text-size-small")}
        />
        {index < steps.length - 1 ? separator : ""}
      </Fragment>
    );
  });

  return <div className={styles.container}>{details}</div>;
};
