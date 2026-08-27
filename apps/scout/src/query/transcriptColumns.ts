import { Column } from "@tsmono/inspect-common/query";

/**
 * Transcript-specific column definitions for building filter conditions.
 *
 * Provides predefined columns matching the transcript schema, plus dynamic
 * field access for custom or nested fields.
 */
export class TranscriptColumns {
  // Predefined transcript fields (matching Python columns.py)
  readonly transcript_id = new Column("transcript_id");
  readonly source_type = new Column("source_type");
  readonly source_id = new Column("source_id");
  readonly source_uri = new Column("source_uri");
  readonly date = new Column("date");
  readonly task_set = new Column("task_set");
  readonly task_id = new Column("task_id");
  readonly task_repeat = new Column("task_repeat");
  readonly agent = new Column("agent");
  readonly agent_args = new Column("agent_args");
  readonly model = new Column("model");
  readonly model_options = new Column("model_options");
  readonly score = new Column("score");
  readonly success = new Column("success");
  readonly total_time = new Column("total_time");
  readonly message_count = new Column("message_count");
  readonly error = new Column("error");
  readonly limit = new Column("limit");

  // Dynamic field access via Proxy
  private static createProxy(): TranscriptColumns {
    const instance = new TranscriptColumns();
    return new Proxy(instance, {
      get(target, prop: string | symbol) {
        if (typeof prop === "symbol") return undefined;
        if (prop.startsWith("_")) return undefined; // block private access

        // A predefined column (or `field`) comes back as-is; anything else
        // becomes a Column for that custom transcript field.
        if (prop in target) {
          const member: unknown = Reflect.get(target, prop);
          return member;
        }
        return new Column(prop);
      },
    });
  }

  // Singleton instance
  private static _instance: TranscriptColumns | null = null;
  static get instance(): TranscriptColumns {
    if (!TranscriptColumns._instance) {
      TranscriptColumns._instance = TranscriptColumns.createProxy();
    }
    return TranscriptColumns._instance;
  }

  // Bracket notation for JSON paths in transcript metadata
  field(name: string): Column {
    return new Column(name);
  }
}

/**
 * Reads a column off the singleton by name. The class type declares only the
 * predefined fields, so dynamic access goes through the same untyped door the
 * Proxy opens — and comes back narrowed, not asserted. Blocked names
 * (underscore-prefixed, symbols) read as undefined.
 */
export const transcriptColumn = (name: string): Column | undefined => {
  const column: unknown = Reflect.get(transcriptColumns, name);
  return column instanceof Column ? column : undefined;
};

// Export singleton instance for transcript filtering
export const transcriptColumns = TranscriptColumns.instance;
