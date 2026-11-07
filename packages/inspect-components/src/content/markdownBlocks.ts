// Shared blocks for the Markdown exports (eventsToMarkdown,
// messagesToMarkdown). Code delimiters are longer than any backtick run in the
// value, so the value always renders verbatim.

const longestBacktickRun = (value: string): number => {
  let longest = 0;
  for (const run of value.matchAll(/`+/g)) {
    longest = Math.max(longest, run[0].length);
  }
  return longest;
};

// A space pads a value that starts or ends with a backtick (CommonMark strips
// one space each side).
export const inlineCode = (value: string): string => {
  const ticks = "`".repeat(longestBacktickRun(value) + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${ticks}${pad}${value}${pad}${ticks}`;
};

export const fenced = (value: string): string => {
  const fence = "`".repeat(Math.max(2, longestBacktickRun(value)) + 1);
  return `${fence}\n${value}\n${fence}`;
};

export const quoted = (value: string): string =>
  value
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
