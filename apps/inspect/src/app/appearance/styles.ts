import { CSSProperties } from "react";

import { FontSize, TextStyle } from "./fonts";

export const ApplicationStyles = {
  moreButton: {
    maxHeight: "1.8em",
    fontSize: FontSize.smaller,
    padding: "0 0.2em 0 0.2em",
    ...TextStyle.secondary,
  },
  threeLineClamp: {
    display: "-webkit-box",
    WebkitLineClamp: "3",
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  lineClamp: (len: number): CSSProperties => {
    return {
      display: "-webkit-box",
      WebkitLineClamp: `${len}`,
      WebkitBoxOrient: "vertical",
      overflow: "hidden",
    };
  },
  wrapText: () => {
    return {
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
      overflow: "hidden",
    };
  },
  scoreFills: {
    green: {
      backgroundColor: "var(--inspect-success)",
      borderColor: "var(--inspect-success)",
      color: "var(--inspect-background)",
    },
    red: {
      backgroundColor: "var(--inspect-danger)",
      borderColor: "var(--inspect-danger)",
      color: "var(--inspect-background)",
    },
    orange: {
      backgroundColor: "var(--inspect-orange)",
      borderColor: "var(--inspect-orange)",
      color: "var(--inspect-background)",
    },
  },
};
