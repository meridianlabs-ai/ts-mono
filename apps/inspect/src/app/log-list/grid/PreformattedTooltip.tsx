import type { CustomTooltipProps } from "ag-grid-react";
import { FC } from "react";

export const PreformattedTooltip: FC<CustomTooltipProps> = ({ value }) => {
  if (!value) return null;
  return (
    <div
      style={{
        backgroundColor: "var(--inspect-background, #fff)",
        border: "1px solid var(--inspect-border, #dee2e6)",
        borderRadius: "4px",
        padding: "8px",
        maxWidth: "500px",
        maxHeight: "400px",
        overflow: "auto",
        whiteSpace: "pre",
        fontFamily: "monospace",
        fontSize: "10px",
      }}
    >
      {value}
    </div>
  );
};
