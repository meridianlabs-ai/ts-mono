import { CSSProperties } from "react";

export const ApplicationStyles = {
  lineClamp: (len: number): CSSProperties => {
    return {
      display: "-webkit-box",
      WebkitLineClamp: `${len}`,
      WebkitBoxOrient: "vertical",
      overflow: "hidden",
    };
  },
};
