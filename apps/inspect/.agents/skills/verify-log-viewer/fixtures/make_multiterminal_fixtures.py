"""Build multi-terminal `.eval` fixtures from the design brief's SE session data.

Each brief JSON (`fix-failing-tests`, `profile-slow-endpoint`,
`refactor-api-module`) becomes a single-sample log whose store holds the
terminal casts and whose transcript has one model turn per `terminal` tool call
(the recorded `send` calls plus synthesized `open`, `read` and `submit` calls).
A fourth log splits `fix-failing-tests` between a `main` agent and a concurrent
`test-runner` subagent. Timestamps come from the data, so output is
deterministic.

Usage:
    python make_multiterminal_fixtures.py --out-dir logs-multiterminal
"""

import argparse
import copy
import hashlib
import json
import math
import random
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from inspect_ai.dataset import Sample
from inspect_ai.event import (
    Event,
    ModelEvent,
    SampleInitEvent,
    SpanBeginEvent,
    SpanEndEvent,
    ToolEvent,
)
from inspect_ai.log import (
    EvalConfig,
    EvalDataset,
    EvalLog,
    EvalPlan,
    EvalResults,
    EvalSample,
    EvalSpec,
    EvalStats,
    write_eval_log,
)
from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessage,
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageTool,
    ChatMessageUser,
    GenerateConfig,
    ModelOutput,
    ModelUsage,
)
from inspect_ai.tool import ToolCall, ToolInfo, ToolParam, ToolParams



def default_data_dir() -> Path | None:
    """The design brief's data when run from an inspect_ai checkout."""
    parents = Path(__file__).resolve().parents
    if len(parents) <= 10:
        return None
    return parents[10] / "design" / "inspect-multiterminal-design-brief" / "data"


MODEL = "mockllm/model"
READ_COUNTS = {
    "fix-failing-tests": 6,
    "profile-slow-endpoint": 0,
    "refactor-api-module": 2,
}
SUBAGENT = "test-runner"
SUBAGENT_SESSIONS = ("tests", "build")
TOOL_DURATION = {"open": 0.15, "read": 0.1, "submit": 0.05}

TASK_PROMPTS = {
    "fix-failing-tests": (
        "The webapp test suite is failing after the latest merge. Find the "
        "failing tests, fix the underlying bugs (not the tests), and make sure "
        "the build and dev server still work. Use terminal sessions as needed."
    ),
    "profile-slow-endpoint": (
        "Users report that GET /api/orders has become slow. Profile the "
        "endpoint, identify the bottleneck, fix it, and show a before/after "
        "benchmark. Use terminal sessions as needed."
    ),
    "refactor-api-module": (
        "Refactor src/api so request handlers share a single validation and "
        "error-handling layer. Keep the public routes unchanged and the test "
        "suite green. Use terminal sessions as needed."
    ),
}
SYSTEM_PROMPT = (
    "You are a software engineer working in a TypeScript web application "
    "repository. Use the terminal tool to open named sessions, send keystrokes "
    "and read their output. Call submit when the task is complete."
)
SUBAGENT_PROMPT = (
    "You are the test-runner agent. Run and watch the test suite and the "
    "production build in your own terminal sessions and report failures."
)

TOOLS = [
    ToolInfo(
        name="terminal",
        description="Interact with a named terminal session.",
        parameters=ToolParams(
            properties={
                "session": ToolParam(type="string", description="Session name."),
                "action": ToolParam(
                    type="string",
                    description="Action to take.",
                    enum=["open", "send", "read"],
                ),
                "keystrokes": ToolParam(
                    type="string", description="Keystrokes to send (for send)."
                ),
            },
            required=["session", "action"],
        ),
    ),
    ToolInfo(
        name="submit",
        description="Submit an answer for evaluation.",
        parameters=ToolParams(
            properties={"answer": ToolParam(type="string", description="Answer.")},
            required=["answer"],
        ),
    ),
]

ANSI_RE = re.compile(
    r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]"
)


@dataclass
class Terminal:
    session: str
    store_key: str
    start: float
    end: float
    header: dict[str, Any]
    events: list[list[Any]]


@dataclass
class Call:
    id: str
    function: str
    session: str | None
    action: str
    start: float
    end: float
    result: str
    text: str
    keystrokes: str | None = None
    uuid: str | None = None
    agent: str = "main"
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass
class Fixture:
    name: str
    data: dict[str, Any]
    terminals: dict[str, Terminal]
    calls: list[Call]
    agents: dict[str, str]  # session -> agent name (empty for single-agent)


def short_id(*parts: str) -> str:
    """Deterministic 22-char id (shortuuid-like)."""
    digest = hashlib.sha256("/".join(parts).encode()).hexdigest()
    return format(int(digest, 16), "x")[:22]


def utc(origin: float, offset: float) -> datetime:
    return datetime.fromtimestamp(origin + offset, tz=timezone.utc)


def parse_terminal(raw: dict[str, Any]) -> Terminal:
    lines = raw["cast"].splitlines()
    events = [json.loads(line) for line in lines[1:] if line.strip()]
    # the viewer takes a session's lifetime from its cast's last event time
    duration = float(raw["durationSeconds"])
    if not events or events[-1][0] < duration:
        events.append([round(duration, 6), "o", ""])
    return Terminal(
        session=raw["session"],
        store_key=raw["storeKey"],
        start=float(raw["startOffset"]),
        end=float(raw["endOffset"]),
        header=json.loads(lines[0]),
        events=events,
    )


def cast_text(terminal: Terminal) -> str:
    lines = [json.dumps(terminal.header)]
    lines.extend(json.dumps(ev) for ev in terminal.events)
    return "\n".join(lines) + "\n"


def output_tail(terminal: Terminal, local_time: float, lines: int = 12) -> str:
    """Plain-text tail of a terminal's output up to `local_time`."""
    text = "".join(
        ev[2] for ev in terminal.events if ev[1] == "o" and ev[0] <= local_time
    )
    text = ANSI_RE.sub("", text).replace("\r\n", "\n")
    rows = [row.split("\r")[-1] for row in text.split("\n")]
    return "\n".join(rows[-lines:]).strip("\n")


def insert_marker(terminal: Terminal, local_time: float, label: str) -> None:
    ev = [round(local_time, 6), "m", label]
    idx = next(
        (i for i, e in enumerate(terminal.events) if e[0] > local_time),
        len(terminal.events),
    )
    terminal.events.insert(idx, ev)


def overlaps(calls: list[Call], start: float, end: float, pad: float = 1.0) -> bool:
    return any(start < c.end + pad and c.start < end + pad for c in calls)


def build_fixture(data: dict[str, Any], multiagent: bool) -> Fixture:
    sample_id = str(data["sampleId"])
    terminals = {t.session: t for t in map(parse_terminal, data["terminals"])}
    rng = random.Random(sample_id)

    calls = [
        Call(
            id=tc["toolCallId"],
            function="terminal",
            session=tc["session"],
            action=tc["action"],
            start=float(tc["startOffset"]),
            end=float(tc["endOffset"]),
            result=tc["result"],
            text=tc["assistantText"],
            keystrokes=tc["keystrokes"],
            uuid=tc.get("eventUuid"),
        )
        for tc in data["toolCalls"]
    ]
    calls.sort(key=lambda c: c.start)
    sends = list(calls)

    # one `open` per terminal, aligned with the cast's `open <session>` marker
    for t in sorted(terminals.values(), key=lambda t: t.start):
        marker = next(
            ev[0] for ev in t.events if ev[1] == "m" and ev[2] == f"open {t.session}"
        )
        start = t.start + marker
        while overlaps(sends, start, start + TOOL_DURATION["open"], pad=0.05):
            start += 0.25
        assert start - (t.start + marker) <= 5, f"cannot place open {t.session}"
        calls.append(
            Call(
                id=f"call-open-{t.session}",
                function="terminal",
                session=t.session,
                action="open",
                start=start,
                end=start + TOOL_DURATION["open"],
                result=f"opened session {t.session}",
                text=f"I'll open a terminal session named '{t.session}'.",
            )
        )

    # `read` calls in the largest gaps between commands, spread across sessions
    n_reads = READ_COUNTS.get(sample_id, 0)
    if n_reads:
        cap = math.ceil(n_reads / len(terminals))
        gaps = sorted(
            zip(sends, sends[1:]),
            key=lambda pair: pair[1].start - pair[0].end,
            reverse=True,
        )
        per_session: dict[str, int] = {}
        reads: list[Call] = []
        for prev, nxt in gaps:
            if len(reads) == n_reads:
                break
            session = str(prev.session)
            when = round((prev.end + nxt.start) / 2, 3)
            t = terminals[session]
            if per_session.get(session, 0) >= cap or not t.start < when < t.end:
                continue
            if overlaps(calls + reads, when, when + TOOL_DURATION["read"], pad=5):
                continue
            per_session[session] = per_session.get(session, 0) + 1
            reads.append(
                Call(
                    id=f"call-read-{session}-{len(reads):02d}",
                    function="terminal",
                    session=session,
                    action="read",
                    start=when,
                    end=when + TOOL_DURATION["read"],
                    result=output_tail(t, when - t.start),
                    text=f"Let me check the latest output in '{session}'.",
                )
            )
        assert len(reads) == n_reads, f"placed {len(reads)}/{n_reads} reads"
        for r in reads:
            t = terminals[str(r.session)]
            insert_marker(t, r.start - t.start, f"read {r.session}")
        calls.extend(reads)

    last_close = max(t.end for t in terminals.values())
    submit_at = last_close + rng.uniform(4, 8)
    calls.append(
        Call(
            id="call-submit",
            function="submit",
            session=None,
            action="submit",
            start=submit_at,
            end=submit_at + TOOL_DURATION["submit"],
            result="Submitted.",
            text="The fix is in place and all checks pass. Submitting.",
        )
    )
    calls.sort(key=lambda c: c.start)
    for prev, nxt in zip(calls, calls[1:]):
        assert prev.end <= nxt.start, f"overlapping calls {prev.id} / {nxt.id}"

    agents: dict[str, str] = {}
    if multiagent:
        missing = [s for s in SUBAGENT_SESSIONS if s not in terminals]
        assert not missing, f"missing subagent sessions: {missing}"
        agents = {s: SUBAGENT if s in SUBAGENT_SESSIONS else "main" for s in terminals}

    for c in calls:
        if c.function == "terminal":
            c.arguments = {"session": c.session, "action": c.action}
            if c.action == "send":
                c.arguments["keystrokes"] = c.keystrokes
        else:
            c.arguments = {"answer": "Fixed the failing tests; suite is green."}
        c.agent = agents.get(str(c.session), "main")

    return Fixture(
        name=sample_id + ("-multiagent" if multiagent else ""),
        data=data,
        terminals=terminals,
        calls=calls,
        agents=agents,
    )


def usage(rng: random.Random, input_messages: int) -> ModelUsage:
    input_tokens = 900 + input_messages * 180 + rng.randint(0, 120)
    output_tokens = rng.randint(40, 220)
    return ModelUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
    )


def build_log(fx: Fixture) -> EvalLog:
    data = fx.data
    origin = float(data["clock"]["originEpoch"])
    sample_id = str(data["sampleId"])
    rng = random.Random(fx.name)
    prompt = TASK_PROMPTS.get(sample_id, f"Complete the task: {sample_id}.")
    multiagent = bool(fx.agents)

    # model turn start/end offsets, strictly increasing and clear of prior tools
    turns: list[tuple[float, float]] = []
    prev_end = fx.calls[0].start - 5
    for c in fx.calls:
        start = max(c.start - rng.uniform(1, 3), prev_end + 0.05)
        start = min(start, c.start - 0.02)
        turns.append((start, c.start - 0.01))
        prev_end = c.end
    final_start = fx.calls[-1].end + 0.2
    final_turn = (final_start, final_start + rng.uniform(1, 2))

    sample_start = turns[0][0] - 1.0
    sample_end = final_turn[1] + 0.2

    def ts(offset: float) -> datetime:
        return utc(origin, offset)

    def ws(offset: float) -> float:
        return round(offset - sample_start, 3)

    init_span = short_id(fx.name, "span", "init")
    solvers_span = short_id(fx.name, "span", "solvers")
    agent_spans = {
        name: short_id(fx.name, "span", "agent", name)
        for name in sorted(set(fx.agents.values()))
    }
    sample = Sample(id=sample_id, input=prompt, target="")

    def span_begin(
        at: float, id: str, name: str, type: str, parent: str | None
    ) -> SpanBeginEvent:
        return SpanBeginEvent(
            uuid=short_id(fx.name, "begin", id),
            span_id=parent,
            timestamp=ts(at),
            working_start=ws(at),
            id=id,
            parent_id=parent,
            type=type,
            name=name,
        )

    def span_end(at: float, id: str, parent: str | None) -> SpanEndEvent:
        return SpanEndEvent(
            uuid=short_id(fx.name, "end", id),
            span_id=parent,
            timestamp=ts(at),
            working_start=ws(at),
            id=id,
        )

    events: list[Event] = [
        span_begin(sample_start, init_span, "init", "init", None),
        SampleInitEvent(
            uuid=short_id(fx.name, "sample_init"),
            span_id=init_span,
            timestamp=ts(sample_start),
            working_start=0,
            sample=sample,
            state={"messages": [], "store": {}},
        ),
        span_end(sample_start, init_span, None),
        span_begin(sample_start + 0.01, solvers_span, "solvers", "solvers", None),
    ]

    # per-agent conversations; the main agent's is the sample's messages
    conversations: dict[str, list[ChatMessage]] = {
        "main": [
            ChatMessageSystem(id=short_id(fx.name, "sys"), content=SYSTEM_PROMPT),
            ChatMessageUser(id=short_id(fx.name, "user"), content=prompt),
        ]
    }
    if multiagent:
        conversations[SUBAGENT] = [
            ChatMessageSystem(
                id=short_id(fx.name, "sys", SUBAGENT), content=SUBAGENT_PROMPT
            ),
            ChatMessageUser(
                id=short_id(fx.name, "user", SUBAGENT),
                content="Run the test suite and build; keep watching for failures.",
            ),
        ]
        last = {a: max(c.end for c in fx.calls if c.agent == a) for a in agent_spans}
        last["main"] = sample_end - 0.1  # main's span also holds the final turn
    open_spans: set[str] = set()

    tool_spans: dict[str, str] = {}
    total = ModelUsage()

    def agent_parent(agent: str) -> str:
        return solvers_span if agent == "main" else agent_spans["main"]

    def agent_span_for(agent: str, at: float) -> str:
        """Enter the agent span on first use (spans of concurrent agents interleave)."""
        span = agent_spans[agent]
        if span not in open_spans:
            parent = agent_parent(agent)
            if agent != "main":
                agent_span_for("main", at)
            events.append(span_begin(at - 0.005, span, agent, "agent", parent))
            open_spans.add(span)
        return span

    def close_finished_spans(now: float) -> None:
        for agent in sorted(agent_spans, key=lambda a: a == "main"):
            span = agent_spans[agent]
            if span in open_spans and last[agent] < now:
                events.append(span_end(last[agent] + 0.005, span, agent_parent(agent)))
                open_spans.remove(span)

    def model_turn(
        agent: str, start: float, end: float, message: ChatMessageAssistant
    ) -> None:
        nonlocal total
        span = agent_span_for(agent, start) if multiagent else solvers_span
        convo = conversations[agent]
        u = usage(rng, len(convo))
        total = total + u
        events.append(
            ModelEvent(
                uuid=short_id(fx.name, "model", str(message.id)),
                span_id=span,
                timestamp=ts(start),
                working_start=ws(start),
                completed=ts(end),
                working_time=round(end - start, 3),
                model=MODEL,
                input=list(convo),
                tools=TOOLS,
                tool_choice="auto",
                config=GenerateConfig(),
                output=ModelOutput(
                    model="model",
                    choices=[
                        ChatCompletionChoice(
                            message=message,
                            stop_reason="tool_calls" if message.tool_calls else "stop",
                        )
                    ],
                    usage=u,
                    time=round(end - start, 3),
                ),
            )
        )
        convo.append(message)

    for c, (m_start, m_end) in zip(fx.calls, turns):
        if multiagent:
            close_finished_spans(m_start)
        agent = c.agent
        assistant = ChatMessageAssistant(
            id=short_id(fx.name, "assistant", c.id),
            content=c.text,
            model="model",
            tool_calls=[ToolCall(id=c.id, function=c.function, arguments=c.arguments)],
        )
        model_turn(agent, m_start, m_end, assistant)
        parent = agent_spans[agent] if multiagent else solvers_span
        tool_span = short_id(fx.name, "span", "tool", c.id)
        tool_spans[c.id] = tool_span
        events.append(span_begin(c.start, tool_span, c.function, "tool", parent))
        events.append(
            ToolEvent(
                uuid=c.uuid or short_id(fx.name, "tool", c.id),
                span_id=tool_span,
                timestamp=ts(c.start),
                working_start=ws(c.start),
                completed=ts(c.end),
                working_time=round(c.end - c.start, 3),
                id=c.id,
                function=c.function,
                arguments=c.arguments,
                result=c.result,
            )
        )
        events.append(span_end(c.end, tool_span, parent))
        conversations[agent].append(
            ChatMessageTool(
                id=short_id(fx.name, "tool-msg", c.id),
                content=c.result,
                tool_call_id=c.id,
                function=c.function,
            )
        )

    final = ChatMessageAssistant(
        id=short_id(fx.name, "assistant", "final"),
        content="Done: the failing behaviour is fixed and verified in the terminals.",
        model="model",
    )
    if multiagent:
        close_finished_spans(final_turn[0])
    model_turn("main", final_turn[0], final_turn[1], final)
    if multiagent:
        close_finished_spans(math.inf)
    events.append(span_end(sample_end - 0.05, solvers_span, None))

    # store: casts with viewer header fields, plus one non-cast key that the
    # Info tab's Store card keeps
    store: dict[str, Any] = {"webapp:ticket": "WEB-1432"}
    for t in fx.terminals.values():
        t.header["ir_session"] = t.session
        if multiagent:
            agent = fx.agents[t.session]
            t.header["ir_agent"] = agent
            t.header["ir_agent_span_id"] = agent_spans[agent]
            t.header["ir_tool_span_id"] = tool_spans[f"call-open-{t.session}"]
        store[t.store_key] = cast_text(t)

    messages = conversations["main"]
    created = ts(sample_start).isoformat()
    eval_id = short_id(fx.name, "eval")
    spec = EvalSpec(
        eval_id=eval_id,
        run_id=short_id(fx.name, "run"),
        created=created,
        task=str(data["task"]),
        task_id=short_id(fx.name, "task"),
        task_version=0,
        dataset=EvalDataset(name=sample_id, samples=1, sample_ids=[sample_id]),
        model=MODEL,
        config=EvalConfig(epochs=1),
    )
    eval_sample = EvalSample(
        id=sample_id,
        epoch=int(data.get("epoch", 1)),
        input=prompt,
        target="",
        messages=messages,
        output=ModelOutput(
            model="model",
            choices=[ChatCompletionChoice(message=final, stop_reason="stop")],
        ),
        store=store,
        events=events,
        model_usage={MODEL: total},
        started_at=ts(sample_start),
        completed_at=ts(sample_end),
        total_time=round(sample_end - sample_start, 3),
        working_time=round(sample_end - sample_start, 3),
        uuid=short_id(fx.name, "sample"),
    )
    return EvalLog(
        version=2,
        status="success",
        eval=spec,
        plan=EvalPlan(),
        results=EvalResults(total_samples=1, completed_samples=1),
        stats=EvalStats(
            started_at=created,
            completed_at=ts(sample_end).isoformat(),
            model_usage={MODEL: total},
        ),
        samples=[eval_sample],
    )


def log_filename(fx: Fixture) -> str:
    stamp = utc(float(fx.data["clock"]["originEpoch"]), 0).strftime("%Y-%m-%dT%H-%M-%S")
    return f"{stamp}_{fx.name}_{short_id(fx.name, 'file')}.eval"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.data_dir is None:
        parser.error("--data-dir is required outside an inspect_ai checkout")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(args.data_dir.glob("*.json")):
        data = json.loads(path.read_text())
        variants = [False]
        if data["sampleId"] == "fix-failing-tests":
            variants.append(True)
        for multiagent in variants:
            fx = build_fixture(copy.deepcopy(data), multiagent)
            out = args.out_dir / log_filename(fx)
            write_eval_log(build_log(fx), str(out), format="eval")
            print(out)


if __name__ == "__main__":
    main()
