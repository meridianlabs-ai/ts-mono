// The rich (colored) terminal renderer, loaded on demand by ANSIDisplay so
// ansi-output is never fetched or run for untrusted content.
import {
  ANSIColor,
  ANSIOutput,
  ANSIOutputLine,
  ANSIOutputRun,
  ANSIStyle,
} from "ansi-output";
import clsx from "clsx";
import { FC, useCallback, useState } from "react";

import { stripAnsi } from "@tsmono/util";

import { useProgressiveTask } from "../hooks/useProgressiveTask";
import { useRevealedChildren } from "../hooks/useRevealedChildren";

import type { ANSIDisplayProps } from "./AnsiDisplay";
import ansiStyles from "./AnsiDisplay.module.css";
import styles from "./AnsiDisplayRich.module.css";
import { ChunkedText, chunkProps, useChunkLayout } from "./ChunkedText";
import { kChunkSize, kChunkThreshold } from "./textChunks";
import { ToolButton } from "./ToolButton";
import { yieldToBrowser } from "./yieldToBrowser";

const RichANSIDisplay: FC<ANSIDisplayProps> = ({
  output,
  style,
  className,
}) => {
  const [showRaw, setShowRaw] = useState(false);
  const outputLines = useAnsiLines(output);
  if (!outputLines) {
    // A huge output is still parsing: show its text, escapes removed.
    return (
      <div
        className={clsx(ansiStyles.ansiDisplayContainer, className)}
        style={style}
      >
        <pre className={ansiStyles.ansiDisplay}>
          <ChunkedText text={stripAnsi(output)} />
        </pre>
      </div>
    );
  }

  // Check if more than 80% of lines share the same background color
  const getUniformBackgroundColor = (): string | undefined => {
    const backgroundColorCounts = new Map<string, number>();
    let totalLinesWithBackground = 0;

    // Count background colors across all lines
    for (const line of outputLines) {
      let lineBackgroundColor: string | undefined = undefined;

      // Get the background color for this line (from any run that has one)
      for (const run of line.outputRuns) {
        if (run.format?.backgroundColor) {
          lineBackgroundColor = run.format.backgroundColor;
          break;
        }
      }

      if (lineBackgroundColor) {
        totalLinesWithBackground++;
        backgroundColorCounts.set(
          lineBackgroundColor,
          (backgroundColorCounts.get(lineBackgroundColor) || 0) + 1
        );
      }
    }

    // Return undefined if no lines have backgrounds
    if (totalLinesWithBackground === 0) {
      return undefined;
    }

    // Compute percentages for each background color
    const backgroundColorPercentages = new Map<string, number>();
    for (const [color, count] of backgroundColorCounts.entries()) {
      backgroundColorPercentages.set(color, count / totalLinesWithBackground);
    }

    // Find the color with the highest percentage
    let dominantColor: string | undefined = undefined;
    let maxPercentage = 0;

    for (const [color, percentage] of backgroundColorPercentages.entries()) {
      if (percentage > maxPercentage) {
        maxPercentage = percentage;
        dominantColor = color;
      }
    }

    // Return the color if it appears in more than 80% of lines
    return maxPercentage > 0.8 ? dominantColor : undefined;
  };

  const uniformBackgroundColor = getUniformBackgroundColor();
  const backgroundStyle = uniformBackgroundColor
    ? computeForegroundBackgroundColor(kBackground, uniformBackgroundColor)
    : {};

  const firstOutputIndex = outputLines.findIndex(
    (line) => line.outputRuns.length > 0
  );
  return (
    <div
      className={clsx(
        ansiStyles.ansiDisplayContainer,
        styles.container,
        className
      )}
      style={{ ...style }}
    >
      <ToolButton
        className={clsx(styles.toggle, "text-size-smallest")}
        icon="code"
        label=""
        latched={showRaw}
        onClick={() => setShowRaw(!showRaw)}
        title={showRaw ? "Show rendered output" : "Show raw output"}
      />
      {showRaw ? (
        <pre
          className={clsx(ansiStyles.ansiDisplay, ansiStyles.ansiDisplayRaw)}
        >
          <ChunkedText text={output} />
        </pre>
      ) : (
        <div className={clsx(ansiStyles.ansiDisplay)} style={backgroundStyle}>
          {output.length > kChunkThreshold &&
          longestLine(outputLines) > kChunkSize ? (
            // Lines don't split across chunks, so a huge line would be one
            // huge element: show its text, without colors.
            <ChunkedText text={stripAnsi(output)} />
          ) : output.length > kChunkThreshold ? (
            <LineChunks
              lines={outputLines}
              firstOutputIndex={firstOutputIndex}
            />
          ) : (
            outputLines.map((line, index) => (
              <OutputLine
                key={index}
                line={line}
                index={index}
                firstOutputIndex={firstOutputIndex}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The output's lines with their runs' formats resolved. A huge output is
 * parsed a slice at a time (the parser carries escape state across slices),
 * so it is undefined until parsing finishes; anything else parses at once.
 */
const useAnsiLines = (output: string): ANSIOutputLine[] | undefined => {
  const huge = output.length > kChunkThreshold;
  // Its identity restarts parsing, so it must change only with its inputs.
  const parse = useCallback(
    async (publish: (lines: ANSIOutputLine[]) => void, signal: AbortSignal) => {
      if (!huge) {
        return;
      }
      const ansiOutput = new ANSIOutput();
      let sliceStart = performance.now();
      for (let i = 0; i < output.length; i += kParseSlice) {
        ansiOutput.processOutput(output.slice(i, i + kParseSlice));
        if (performance.now() - sliceStart > kSliceMs) {
          await yieldToBrowser();
          signal.throwIfAborted();
          sliceStart = performance.now();
        }
      }
      publish(ansiOutput.outputLines);
    },
    [output, huge]
  );
  const parsed = useProgressiveTask(parse);
  if (huge) {
    return parsed;
  }
  const ansiOutput = new ANSIOutput();
  ansiOutput.processOutput(output);
  return ansiOutput.outputLines;
};

const kParseSlice = 65_536;
const kSliceMs = 12;

interface OutputLineProps {
  line: ANSIOutputLine;
  index: number;
  firstOutputIndex: number;
}

const OutputLine: FC<OutputLineProps> = ({ line, index, firstOutputIndex }) => (
  <div>
    {!line.outputRuns.length ? (
      // Blank lines keep their height once output has started.
      firstOutputIndex !== -1 && index > firstOutputIndex ? (
        <br />
      ) : null
    ) : (
      line.outputRuns.map((outputRun) => (
        <OutputRun key={outputRun.id} run={outputRun} />
      ))
    )}
  </div>
);

// Each run carries its resolved format, so lines group into chunks without
// carrying any escape-sequence state across a chunk boundary.
// Building a rich line costs a few elements per run, so a chunk shows its
// plain text (the same characters) until it first nears the viewport.
const LineChunks: FC<{
  lines: ANSIOutputLine[];
  firstOutputIndex: number;
}> = ({ lines, firstOutputIndex }) => {
  const ref = useChunkLayout<HTMLDivElement>(lines);
  const revealed = useRevealedChildren(ref, lines);
  return (
    <div ref={ref} data-chunk-container>
      {lineGroups(lines).map(({ start, end, chars }, group) => (
        <LineGroup
          key={start}
          lines={lines}
          start={start}
          end={end}
          chars={chars}
          firstOutputIndex={firstOutputIndex}
          revealed={revealed.has(group)}
        />
      ))}
    </div>
  );
};

// A component per group so each reveal rebuilds only the revealed group, not
// every other group's plain text.
const LineGroup: FC<{
  lines: ANSIOutputLine[];
  start: number;
  end: number;
  chars: number;
  firstOutputIndex: number;
  revealed: boolean;
}> = ({ lines, start, end, chars, firstOutputIndex, revealed }) => (
  <div {...chunkProps(chars, end - start)}>
    {revealed ? (
      lines
        .slice(start, end)
        .map((line, offset) => (
          <OutputLine
            key={start + offset}
            line={line}
            index={start + offset}
            firstOutputIndex={firstOutputIndex}
          />
        ))
    ) : (
      <div className={styles.plainLines}>
        {plainLines(lines, start, end, firstOutputIndex)}
      </div>
    )}
  </div>
);

// What the rich lines show, as text: a line per line, none before the first
// line with output.
const plainLines = (
  lines: ANSIOutputLine[],
  start: number,
  end: number,
  firstOutputIndex: number
) =>
  lines
    .slice(
      Math.max(start, firstOutputIndex === -1 ? end : firstOutputIndex),
      end
    )
    .map((line) => line.outputRuns.map((run) => run.text).join(""))
    .join("\n");

const lineLength = (line: ANSIOutputLine) =>
  line.outputRuns.reduce((n, run) => n + run.text.length, 0);

const longestLine = (lines: ANSIOutputLine[]) =>
  lines.reduce((longest, line) => Math.max(longest, lineLength(line)), 0);

const lineGroups = (lines: ANSIOutputLine[]) => {
  const groups: { start: number; end: number; chars: number }[] = [];
  let start = 0;
  let chars = 0;
  lines.forEach((line, index) => {
    chars += lineLength(line) + 1;
    if (chars >= kChunkSize || index === lines.length - 1) {
      groups.push({ start, end: index + 1, chars });
      start = index + 1;
      chars = 0;
    }
  });
  return groups;
};

const kForeground = 0;
const kBackground = 1;

interface OutputRunProps {
  run: ANSIOutputRun;
}

const OutputRun: FC<OutputRunProps> = ({ run }) => {
  // Render.
  return <span style={computeCSSProperties(run)}>{run.text}</span>;
};

const computeCSSProperties = (outputRun: ANSIOutputRun) => {
  return !outputRun.format
    ? {}
    : {
        ...computeStyles(outputRun.format.styles || []),
        ...computeForegroundBackgroundColor(
          kForeground,
          outputRun.format.foregroundColor
        ),
        ...computeForegroundBackgroundColor(
          kBackground,
          outputRun.format.backgroundColor
        ),
      };
};

const computeStyles = (styles: ANSIStyle[]) => {
  let cssProperties = {};
  styles.forEach((style) => {
    switch (style) {
      // Bold.
      case ANSIStyle.Bold:
        cssProperties = { ...cssProperties, ...{ fontWeight: "bold" } };
        break;

      // Dim.
      case ANSIStyle.Dim:
        cssProperties = { ...cssProperties, ...{ fontWeight: "lighter" } };
        break;

      // Italic.
      case ANSIStyle.Italic:
        cssProperties = { ...cssProperties, ...{ fontStyle: "italic" } };
        break;

      // Underlined.
      case ANSIStyle.Underlined:
        cssProperties = {
          ...cssProperties,
          ...{
            textDecorationLine: "underline",
            textDecorationStyle: "solid",
          },
        };
        break;

      // Slow blink.
      case ANSIStyle.SlowBlink:
        cssProperties = {
          ...cssProperties,
          ...{ animation: "ansi-display-run-blink 1s linear infinite" },
        };
        break;

      // Rapid blink.
      case ANSIStyle.RapidBlink:
        cssProperties = {
          ...cssProperties,
          ...{ animation: "ansi-display-run-blink 0.5s linear infinite" },
        };
        break;

      // Hidden.
      case ANSIStyle.Hidden:
        cssProperties = { ...cssProperties, ...{ visibility: "hidden" } };
        break;

      // CrossedOut.
      case ANSIStyle.CrossedOut:
        cssProperties = {
          ...cssProperties,
          ...{
            textDecorationLine: "line-through",
            textDecorationStyle: "solid",
          },
        };
        break;

      // TODO Fraktur

      // DoubleUnderlined.
      case ANSIStyle.DoubleUnderlined:
        cssProperties = {
          ...cssProperties,
          ...{
            textDecorationLine: "underline",
            textDecorationStyle: "double",
          },
        };
        break;

      // TODO Framed
      // TODO Encircled
      // TODO Overlined
      // TODO Superscript
      // TODO Subscript
    }
  });

  return cssProperties;
};

const computeForegroundBackgroundColor = (
  colorType: number,
  color?: string
) => {
  switch (color) {
    // Undefined.
    case undefined:
      return {};

    // One of the standard colors.
    case ANSIColor.Black:
    case ANSIColor.Red:
    case ANSIColor.Green:
    case ANSIColor.Yellow:
    case ANSIColor.Blue:
    case ANSIColor.Magenta:
    case ANSIColor.Cyan:
    case ANSIColor.White:
    case ANSIColor.BrightBlack:
    case ANSIColor.BrightRed:
    case ANSIColor.BrightGreen:
    case ANSIColor.BrightYellow:
    case ANSIColor.BrightBlue:
    case ANSIColor.BrightMagenta:
    case ANSIColor.BrightCyan:
    case ANSIColor.BrightWhite:
      if (colorType === kForeground) {
        return { color: `var(--${color})` };
      } else {
        return { background: `var(--${color})` };
      }

    // TODO@softwarenerd - This isn't hooked up.
    default:
      if (colorType === kForeground) {
        return { color: color };
      } else {
        return { background: color };
      }
  }
};

export default RichANSIDisplay;
