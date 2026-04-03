import { Citations } from "../../../@types/bogusTypes";

export type ChatViewToolCallStyle = "compact" | "complete" | "omit";

export type Citation = NonNullable<Citations>[number];
