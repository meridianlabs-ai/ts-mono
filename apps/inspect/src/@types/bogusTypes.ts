// The old codegen used Content for the type of ChatMessageBase.content,
// which is str | list[Content] in Python. inspect-common correctly uses
// Content for just the union of content objects.
import type { ChatMessage, JsonChange } from "@tsmono/inspect-common";

// Legacy aliases — map old numbered names to inspect-common equivalents.
// Work toward eliminating this file entirely.
export type { ModelUsage } from "@tsmono/inspect-common";
export type { ModelUsageDict } from "@tsmono/inspect-common";
export type { ScoresDict } from "@tsmono/inspect-common";
export type { ScoreValue } from "@tsmono/inspect-common";
export type { ScoreValueOrUnchanged } from "@tsmono/inspect-common";
export type { Tools } from "@tsmono/inspect-common";
export type { Input } from "@tsmono/inspect-common";

// Generic record types (were `interface Foo { [k: string]: unknown }`)
export type Arguments1 = Record<string, unknown>;
export type Input5 = Record<string, unknown>;
export type Params2 = Record<string, unknown>;

export type ChatMessageContent = ChatMessage["content"];

// Scalar aliases from old codegen
export type CompletedAt = string | "";
export type EvalId = string;
export type Model = string;
export type RunId = string;
export type StartedAt = string | "";
export type Target = string | string[];
export type Task = string;
export type TaskId = string;
export type TaskVersion = number | string;
export type TotalTime = number | null;
export type Version = number;
export type WorkingTime = number | null;

export type JsonChanges = JsonChange[];
