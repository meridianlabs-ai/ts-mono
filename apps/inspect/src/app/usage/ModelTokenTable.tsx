import { FC } from "react";

import { ModelUsageDict } from "../../@types/bogusTypes";

import { TokenHeader, TokenRow, TokenTable } from "./TokenTable";

interface ModelTokenTableProps {
  model_usage: ModelUsageDict;
  className?: string | string[];
}

export const ModelTokenTable: FC<ModelTokenTableProps> = ({
  model_usage,
  className,
}) => {
  if (!model_usage) {
    return null;
  }
  return (
    <TokenTable className={className}>
      <TokenHeader />
      <tbody>
        {Object.keys(model_usage).map((key) => {
          return <TokenRow key={key} model={key} usage={model_usage[key]} />;
        })}
      </tbody>
    </TokenTable>
  );
};
