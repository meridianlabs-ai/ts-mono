// inspect_scout's grep_scanner explains a result with one `[M3]: …context…`
// line per match, the match in bold: excerpts of the transcript.
const kExcerptLine = /^\[[ME]\d+\]: .*\*\*.+\*\*/;

/**
 * Whether an explanation is only transcript excerpts. The sidebars that show
 * it sit beside that transcript, so they keep excerpts out of in-page Find,
 * which would otherwise count each match twice. Explanations a scanner writes
 * itself are the only copy of that text, so they stay searchable even where
 * they quote the transcript.
 */
export const isTranscriptExcerpts = (explanation: string): boolean =>
  explanation
    .split("\n")
    .every((line) => line.trim() === "" || kExcerptLine.test(line));
