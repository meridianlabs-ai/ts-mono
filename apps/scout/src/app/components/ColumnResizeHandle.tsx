import clsx from "clsx";
import type { MouseEventHandler, TouchEventHandler } from "react";

import styles from "./ColumnResizeHandle.module.css";

interface ColumnResizeHandleProps {
  name: string;
  size: number;
  minSize: number;
  maxSize: number;
  resizing: boolean;
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  onTouchStart: TouchEventHandler<HTMLDivElement>;
  onResize: (size: number) => void;
  onReset?: () => void;
}

export function ColumnResizeHandle({
  name,
  size,
  minSize,
  maxSize,
  resizing,
  onMouseDown,
  onTouchStart,
  onResize,
  onReset,
}: ColumnResizeHandleProps) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`Resize ${name}`}
      aria-orientation="horizontal"
      aria-valuenow={size}
      aria-valuemin={minSize}
      aria-valuemax={maxSize}
      className={clsx(styles.resizer, resizing && styles.resizerActive)}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onReset?.();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onReset?.();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          onResize(
            Math.max(
              minSize,
              Math.min(maxSize, size + (event.key === "ArrowRight" ? 10 : -10))
            )
          );
        }
      }}
    />
  );
}
