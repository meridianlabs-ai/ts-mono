import clsx from "clsx";
import {
  FC,
  Fragment,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  Ref,
} from "react";

import {
  ActivityMarker,
  ActivitySpan,
  AgentRow,
  CompactionDrop,
  ContextPoint,
  fmtBytes,
  fmtDurationWords,
  fmtSeconds,
  fmtTimeSec,
  fmtTokens,
  kCategoryColor,
  StallRegion,
  TimeWindow,
  ToolBurst,
} from "./activityData";
import styles from "./ActivityTooltip.module.css";

/** Tooltip width — the flip-left threshold in the chart derives from it. */
export const kTooltipWidth = 262;

/** One curve read-out row. `aggregate: "max"` marks a grouped row whose
 *  value is its largest member's rather than a sum — the fold's context,
 *  since context sizes don't add. */
export interface CurveValue {
  row: AgentRow;
  value?: number;
  aggregate?: "max";
}

/** What the pointer is over — one card, different bodies (handoff 11b). */
export type HoverTarget =
  | { kind: "span"; span: ActivitySpan; row: AgentRow }
  | { kind: "burst"; burst: ToolBurst; row: AgentRow; hovered: ActivitySpan }
  | { kind: "marker"; members: ActivityMarker[]; compaction?: CompactionDrop }
  | {
      kind: "context";
      point: ContextPoint;
      row: AgentRow;
      /** The fan-out the point belongs to (two or more calls issued
       *  together), earliest first — the card lists them. */
      parallel?: ContextPoint[];
    }
  | { kind: "stall"; stall: StallRegion }
  | {
      /** A collapsed range — a density-strip bin or a crowded tool half.
       *  `label` counts its calls; `time` is the card's time line. */
      kind: "bin";
      row: AgentRow;
      label: string;
      time: string;
      window: TimeWindow;
      /** The range's earliest event — the footer's target. */
      firstUuid?: string;
    }
  | {
      kind: "curve";
      band: "tokens" | "context";
      time: number;
      /** The cursor's column in Turns mode — the card's `turn N ·` header. */
      turn?: number;
      values: CurveValue[];
    };

/** Stable identity for a hover target — the show-delay compares it. */
export const hoverTargetKey = (target: HoverTarget | null): string | null => {
  if (!target) return null;
  switch (target.kind) {
    case "span":
      return `span:${target.row.id}:${target.span.start}:${target.span.label}`;
    case "burst": {
      // Each lane is its own target (the card marks the hovered member
      // and opens its event), so moving between lanes restarts the dwell.
      // The event uuid is the stable identity: a live completion re-sorts
      // the burst and moves lane indices. Pre-uuid logs fall back to the
      // lane index (two same-named calls can start on the same tick); the
      // namespaces keep a numeric-looking uuid apart from a lane index.
      const { uuid, subLane, label } = target.hovered;
      const member =
        uuid !== undefined
          ? `uuid:${uuid}`
          : subLane !== undefined
            ? `lane:${subLane}`
            : `label:${label}`;
      return `burst:${target.row.id}:${target.burst.start}:${member}`;
    }
    case "marker":
      return `marker:${target.members.map((m) => m.key).join(",")}`;
    case "context":
      return `context:${target.row.id}:${target.point.time}`;
    case "stall":
      return `stall:${target.stall.start}`;
    case "bin":
      // Every row bins the same axis, so the window alone would make row
      // 2's bin read as row 1's (a return to "the same target").
      return `bin:${target.row.id}:${target.window.start}`;
    case "curve":
      return `curve:${target.band}`;
  }
};

export interface ActivityTooltipProps {
  target: HoverTarget;
  /** Axis mode: Turns prefixes the header time with the turn index. */
  turnsMode?: boolean;
  onOpenEvent?: (uuid: string, event: ReactMouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** The card element, for the chart's pointer geometry. */
  ref?: Ref<HTMLDivElement>;
}

const timeRange = (start: number, end: number, pending: boolean): string =>
  end > start
    ? `${fmtTimeSec(start)} → ${pending ? "now" : fmtTimeSec(end)}`
    : fmtTimeSec(start);

/** Card time: the wall range, or `turn N · hh:mm:ss` in Turns mode
 *  (handoff 8b). Rendered on its own line under the header so the
 *  subject keeps the card's full width (design owner, 2026-09-16). */
const headerTime = (
  turn: number | undefined,
  turnsMode: boolean,
  start: number,
  end: number,
  pending: boolean
): string =>
  turnsMode && turn !== undefined
    ? `turn ${turn} · ${fmtTimeSec(start)}`
    : timeRange(start, end, pending);

/** A card that stands for a range of events links to the range's first
 *  event (design owner, 2026-09-16) and says so. */
const kFooterFirst = "open first in transcript →";

interface CardProps {
  subject: ReactNode;
  status?: { text: string; tone: "failed" | "rejected" };
  time: string;
  who?: { hue: string; name: string; model?: string; turn?: number };
  children?: ReactNode;
  uuid?: string;
  footerLabel?: string;
  onOpenEvent?: (uuid: string, event: ReactMouseEvent) => void;
}

const Card: FC<CardProps> = ({
  subject,
  status,
  time,
  who,
  children,
  uuid,
  footerLabel = "open in transcript →",
  onOpenEvent,
}) => (
  <Fragment>
    <div className={styles.header}>
      <span className={styles.subject}>{subject}</span>
      {status && (
        <span
          className={
            status.tone === "failed"
              ? styles.statusFailed
              : styles.statusRejected
          }
        >
          {status.text}
        </span>
      )}
    </div>
    <div className={styles.timeLine}>{time}</div>
    {who && (
      <div className={styles.who}>
        <span className={styles.swatch} style={{ background: who.hue }} />
        <span>{who.name}</span>
        {/* The root row is named after its model — don't say it twice. */}
        {who.model && who.model !== who.name && (
          <span className={styles.muted}>· {who.model}</span>
        )}
        {who.turn !== undefined && (
          <span className={styles.muted}>· turn {who.turn}</span>
        )}
      </div>
    )}
    {children}
    {uuid && onOpenEvent && (
      <button
        type="button"
        className={styles.footer}
        onClick={(event) => {
          event.stopPropagation();
          onOpenEvent(uuid, event);
        }}
      >
        {footerLabel}
      </button>
    )}
  </Fragment>
);

interface GridRow {
  key: string;
  value: ReactNode;
  mono?: boolean;
}

const Grid: FC<{ rows: GridRow[] }> = ({ rows }) => (
  <div className={styles.grid}>
    {rows.slice(0, 4).map((row) => (
      <Fragment key={row.key}>
        <span className={styles.key}>{row.key}</span>
        <span className={clsx(styles.value, row.mono && styles.mono)}>
          {row.value}
        </span>
      </Fragment>
    ))}
  </div>
);

const num = (value: number): string => value.toLocaleString();

const ModelTurnBody: FC<{
  span: ActivitySpan;
  row: AgentRow;
  turnsMode: boolean;
  onOpenEvent?: ActivityTooltipProps["onOpenEvent"];
}> = ({ span, row, turnsMode, onOpenEvent }) => {
  const rows: GridRow[] = [
    { key: "duration", value: fmtSeconds(span.end - span.start), mono: true },
  ];
  if (span.inputTokens !== undefined) {
    rows.push({
      key: "input",
      mono: true,
      value: (
        <Fragment>
          {num(span.inputTokens)}
          {span.cachedTokens !== undefined && span.cachedTokens > 0 && (
            <span className={styles.muted}>
              {" "}
              · {fmtTokens(span.cachedTokens)} cached
            </span>
          )}
        </Fragment>
      ),
    });
  }
  if (span.outputTokens !== undefined) {
    rows.push({ key: "output", value: num(span.outputTokens), mono: true });
  }
  if (span.stopReason !== undefined) {
    const calls = span.toolCalls ?? [];
    rows.push({
      key: "stop",
      mono: true,
      value:
        calls.length > 0
          ? `${span.stopReason} · ${calls.length} (${calls.slice(0, 3).join(", ")}${calls.length > 3 ? ", …" : ""})`
          : span.stopReason,
    });
  }
  if (span.retries !== undefined && span.retries > 0) {
    rows.push({ key: "retries", value: `×${span.retries}`, mono: true });
  }
  return (
    <Card
      subject={
        span.turn !== undefined ? `Model turn ${span.turn}` : "Model call"
      }
      time={headerTime(
        span.turn,
        turnsMode,
        span.start,
        span.end,
        span.pending
      )}
      who={{ hue: row.hue, name: row.name, model: span.label }}
      uuid={span.uuid}
      onOpenEvent={onOpenEvent}
    >
      <Grid rows={rows} />
    </Card>
  );
};

const ToolCallBody: FC<{
  span: ActivitySpan;
  row: AgentRow;
  turnsMode: boolean;
  onOpenEvent?: ActivityTooltipProps["onOpenEvent"];
}> = ({ span, row, turnsMode, onOpenEvent }) => {
  const handoff = span.handoffTo
    ? row.blockedOn.find((b) => b.childId === span.handoffTo)
    : undefined;
  const rows: GridRow[] = [
    { key: "duration", value: fmtSeconds(span.end - span.start), mono: true },
  ];
  if (span.failed) {
    rows.push({
      key: "error",
      mono: true,
      value: (
        <span className={styles.statusFailed}>
          {span.errorMessage ?? "failed"}
        </span>
      ),
    });
  } else if (handoff) {
    rows.push({ key: "result", value: `handed off to ${handoff.childName}` });
  } else if (span.resultBytes !== undefined) {
    rows.push({
      key: "result",
      value: `ok · ${fmtBytes(span.resultBytes)}`,
      mono: true,
    });
  }
  if (span.firstArg !== undefined) {
    rows.push({
      key: span.firstArgKey ?? "arg",
      mono: true,
      value: <span className={styles.ellipsis}>{span.firstArg}</span>,
    });
  }
  return (
    <Card
      subject={
        <Fragment>
          <span className={styles.mono}>{span.label}</span> tool call
        </Fragment>
      }
      status={span.failed ? { text: "failed", tone: "failed" } : undefined}
      time={headerTime(
        span.turn,
        turnsMode,
        span.start,
        span.end,
        span.pending
      )}
      who={{ hue: row.hue, name: row.name, model: row.model, turn: span.turn }}
      uuid={span.uuid}
      onOpenEvent={onOpenEvent}
    >
      <Grid rows={rows} />
    </Card>
  );
};

const BurstBody: FC<{
  burst: ToolBurst;
  row: AgentRow;
  hovered: ActivitySpan;
  turnsMode: boolean;
  onOpenEvent?: ActivityTooltipProps["onOpenEvent"];
}> = ({ burst, row, hovered, turnsMode, onOpenEvent }) => {
  const members = row.spans.filter((s) => s.burst === burst);
  // The card marks the hovered lane, so its link is that member's; a
  // pre-uuid member falls back to the burst's first linkable one.
  const firstUuid = members.find((m) => m.uuid !== undefined)?.uuid;
  return (
    <Card
      subject={
        <Fragment>
          <span className={styles.mono}>{burst.label}</span> ×{burst.count}
        </Fragment>
      }
      status={
        burst.failed > 0
          ? { text: `${burst.failed} failed`, tone: "failed" }
          : undefined
      }
      time={headerTime(hovered.turn, turnsMode, burst.start, burst.end, false)}
      who={{
        hue: row.hue,
        name: row.name,
        model: row.model,
        turn: hovered.turn,
      }}
      uuid={hovered.uuid ?? firstUuid}
      footerLabel={hovered.uuid === undefined ? kFooterFirst : undefined}
      onOpenEvent={onOpenEvent}
    >
      <div className={styles.list}>
        {members.slice(0, 4).map((member, i) => (
          <div
            key={i}
            className={clsx(
              styles.listRow,
              member === hovered && styles.listRowHovered
            )}
          >
            <span className={styles.mono}>{member.label}</span>
            <span className={styles.mono}>
              {fmtSeconds(member.end - member.start)}
            </span>
            <span
              className={member.failed ? styles.statusFailed : styles.muted}
            >
              {member.failed ? "failed" : "ok"}
            </span>
          </div>
        ))}
        {members.length > 4 && (
          <div className={styles.muted}>+{members.length - 4} more</div>
        )}
      </div>
    </Card>
  );
};

const ContextPointBody: FC<{
  point: ContextPoint;
  row: AgentRow;
  parallel?: ContextPoint[];
  turnsMode: boolean;
  onOpenEvent?: ActivityTooltipProps["onOpenEvent"];
}> = ({ point, row, parallel, turnsMode, onOpenEvent }) => {
  const rows: GridRow[] = [];
  // On the wall clock the vertex stands for the whole fan-out (drawn at
  // its largest member), so the card links the fan-out's first call; in
  // Turns mode each call has its own column and the card is its own.
  const collapsed = parallel !== undefined && !turnsMode;
  const first = parallel?.[0];
  const values = parallel?.map((p) => p.value) ?? [];
  if (point.delta !== undefined) {
    rows.push({
      key: "Δ prev turn",
      mono: true,
      value: `${point.delta >= 0 ? "+" : "−"}${num(Math.abs(point.delta))}`,
    });
  }
  if (point.messages !== undefined) {
    rows.push({ key: "messages", value: num(point.messages), mono: true });
  }
  return (
    <Card
      subject={
        <Fragment>
          Context <span className={styles.mono}>{num(point.value)}</span> tokens
        </Fragment>
      }
      time={headerTime(point.turn, turnsMode, point.time, point.time, false)}
      who={{ hue: row.hue, name: row.name, turn: point.turn }}
      uuid={collapsed ? first?.uuid : point.uuid}
      footerLabel={collapsed ? kFooterFirst : undefined}
      onOpenEvent={onOpenEvent}
    >
      {rows.length > 0 && <Grid rows={rows} />}
      {parallel && (
        <div className={styles.list}>
          <div className={styles.note}>
            {parallel.length} parallel calls ·{" "}
            <span className={styles.mono}>
              {num(Math.min(...values))} – {num(Math.max(...values))}
            </span>
          </div>
          {parallel.slice(0, 4).map((member, i) => (
            <div
              key={i}
              className={clsx(
                styles.listRow,
                member === point && styles.listRowHovered
              )}
            >
              <span className={styles.mono}>{num(member.value)} tokens</span>
              <span className={clsx(styles.mono, styles.muted)}>
                {fmtSeconds(member.end - member.time)}
              </span>
              {member.turn !== undefined && (
                <span className={styles.muted}>turn {member.turn}</span>
              )}
            </div>
          ))}
          {parallel.length > 4 && (
            <div className={styles.muted}>+{parallel.length - 4} more</div>
          )}
        </div>
      )}
    </Card>
  );
};

const CompactionBody: FC<{
  marker: ActivityMarker;
  drop: CompactionDrop;
  turnsMode: boolean;
  onOpenEvent?: ActivityTooltipProps["onOpenEvent"];
}> = ({ marker, drop, turnsMode, onOpenEvent }) => {
  const rows: GridRow[] = [];
  if (drop.before !== undefined && drop.after !== undefined) {
    const freed = drop.before - drop.after;
    rows.push({
      key: "context",
      mono: true,
      value: `${num(drop.before)} → ${num(drop.after)}`,
    });
    rows.push({
      key: "freed",
      mono: true,
      value: (
        <Fragment>
          {num(freed)}
          {drop.before > 0 && (
            <span className={styles.muted}>
              {" "}
              · {Math.round((freed / drop.before) * 100)}%
            </span>
          )}
        </Fragment>
      ),
    });
  }
  if (drop.strategy) {
    rows.push({ key: "strategy", value: drop.strategy, mono: true });
  }
  return (
    <Card
      subject={
        <Fragment>
          <span
            className={styles.glyph}
            style={{ color: kCategoryColor.compaction }}
          >
            ▼
          </span>{" "}
          Context compacted
        </Fragment>
      }
      time={headerTime(drop.turn, turnsMode, marker.time, marker.time, false)}
      uuid={marker.uuid}
      onOpenEvent={onOpenEvent}
    >
      {rows.length > 0 && <Grid rows={rows} />}
    </Card>
  );
};

const MarkerBody: FC<{
  members: ActivityMarker[];
  onOpenEvent?: ActivityTooltipProps["onOpenEvent"];
}> = ({ members, onOpenEvent }) => {
  const head = members[0]!;
  if (members.length === 1) {
    return (
      <Card
        subject={
          <Fragment>
            <span
              className={styles.dot}
              style={{ background: kCategoryColor[head.category] }}
            />
            {head.label}
          </Fragment>
        }
        time={fmtTimeSec(head.time)}
        uuid={head.uuid}
        onOpenEvent={onOpenEvent}
      />
    );
  }
  // Members arrive in time order; the earliest linkable one is the target.
  const firstUuid = members.find((m) => m.uuid !== undefined)?.uuid;
  return (
    <Card
      subject={`${members.length} events`}
      time={`${fmtTimeSec(head.time)} → ${fmtTimeSec(members[members.length - 1]!.time)}`}
      uuid={firstUuid}
      footerLabel={kFooterFirst}
      onOpenEvent={onOpenEvent}
    >
      <div className={styles.list}>
        {members.slice(0, 6).map((member, i) => (
          <div key={i} className={styles.listRow}>
            <span
              className={styles.dot}
              style={{ background: kCategoryColor[member.category] }}
            />
            <span className={styles.ellipsis}>{member.label}</span>
            <span className={clsx(styles.mono, styles.muted)}>
              {fmtTimeSec(member.time)}
            </span>
          </div>
        ))}
        {members.length > 6 && (
          <div className={styles.muted}>+{members.length - 6} more</div>
        )}
      </div>
    </Card>
  );
};

const BinBody: FC<{
  label: string;
  time: string;
  firstUuid?: string;
  onOpenEvent?: ActivityTooltipProps["onOpenEvent"];
}> = ({ label, time, firstUuid, onOpenEvent }) => (
  <Card
    subject={label}
    time={time}
    uuid={firstUuid}
    footerLabel={kFooterFirst}
    onOpenEvent={onOpenEvent}
  />
);

const StallBody: FC<{ stall: StallRegion }> = ({ stall }) => (
  <Card
    subject={`Waiting ${fmtDurationWords(stall.duration)}`}
    time={timeRange(stall.start, stall.end, false)}
  >
    <div className={styles.note}>
      {stall.retries !== undefined && stall.retries > 0
        ? `rate-limited, ${stall.retries} ${stall.retries === 1 ? "retry" : "retries"}`
        : "no working-time advance"}
    </div>
  </Card>
);

// A grouped value is captioned `max`; a missing value is a bare dash, never a
// captioned one.
const CurveValueText: FC<{ value?: number; aggregate?: "max" }> = ({
  value,
  aggregate,
}) => (
  <span className={styles.mono}>
    {aggregate === "max" && value !== undefined && (
      <span className={styles.muted}>max </span>
    )}
    {value === undefined ? "—" : num(value)}
  </span>
);

const CurveBody: FC<{
  band: "tokens" | "context";
  time: number;
  turn?: number;
  turnsMode: boolean;
  values: CurveValue[];
}> = ({ band, time, turn, turnsMode, values }) => {
  const headerText = headerTime(turn, turnsMode, time, time, false);
  if (values.length === 1) {
    const only = values[0]!;
    return (
      <Card
        subject={
          <Fragment>
            <CurveValueText value={only.value} aggregate={only.aggregate} />{" "}
            {band === "tokens" ? "tokens burned" : "tokens in context"}
          </Fragment>
        }
        time={headerText}
      />
    );
  }
  return (
    <Card
      subject={band === "tokens" ? "Token burn" : "Context size"}
      time={headerText}
    >
      <div className={styles.list}>
        {values.map(({ row, value, aggregate }) => (
          <div key={row.id} className={styles.listRow}>
            <span className={styles.swatch} style={{ background: row.hue }} />
            <span className={styles.ellipsis}>{row.name}</span>
            <CurveValueText value={value} aggregate={aggregate} />
          </div>
        ))}
      </div>
    </Card>
  );
};

/** The one Activity tooltip: white card, header · who · detail grid ·
 *  `open in transcript →` footer (handoff 11a/11b). */
export const ActivityTooltip: FC<ActivityTooltipProps> = ({
  target,
  turnsMode = false,
  onOpenEvent,
  className,
  style,
  onMouseEnter,
  onMouseLeave,
  ref,
}) => {
  let body: ReactNode;
  switch (target.kind) {
    case "span":
      body =
        target.span.kind === "model" ? (
          <ModelTurnBody
            span={target.span}
            row={target.row}
            turnsMode={turnsMode}
            onOpenEvent={onOpenEvent}
          />
        ) : (
          <ToolCallBody
            span={target.span}
            row={target.row}
            turnsMode={turnsMode}
            onOpenEvent={onOpenEvent}
          />
        );
      break;
    case "burst":
      body = (
        <BurstBody
          burst={target.burst}
          row={target.row}
          hovered={target.hovered}
          turnsMode={turnsMode}
          onOpenEvent={onOpenEvent}
        />
      );
      break;
    case "marker":
      body =
        target.compaction && target.members.length === 1 ? (
          <CompactionBody
            marker={target.members[0]!}
            drop={target.compaction}
            turnsMode={turnsMode}
            onOpenEvent={onOpenEvent}
          />
        ) : (
          <MarkerBody members={target.members} onOpenEvent={onOpenEvent} />
        );
      break;
    case "context":
      body = (
        <ContextPointBody
          point={target.point}
          row={target.row}
          parallel={target.parallel}
          turnsMode={turnsMode}
          onOpenEvent={onOpenEvent}
        />
      );
      break;
    case "stall":
      body = <StallBody stall={target.stall} />;
      break;
    case "bin":
      body = (
        <BinBody
          label={target.label}
          time={target.time}
          firstUuid={target.firstUuid}
          onOpenEvent={onOpenEvent}
        />
      );
      break;
    case "curve":
      body = (
        <CurveBody
          band={target.band}
          time={target.time}
          turn={target.turn}
          turnsMode={turnsMode}
          values={target.values}
        />
      );
      break;
  }
  return (
    <div
      ref={ref}
      className={clsx(styles.tooltip, className)}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {body}
    </div>
  );
};
