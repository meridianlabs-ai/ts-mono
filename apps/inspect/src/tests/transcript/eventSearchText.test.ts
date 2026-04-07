import {
  EventNode,
  eventSearchText,
} from "@tsmono/inspect-components/transcript";

const makeNode = (event: Record<string, unknown>): EventNode => {
  return new EventNode("test-id", event as never, 0);
};

describe("eventSearchText", () => {
  test("score: returns empty for score events (no searchable fields)", () => {
    const texts = eventSearchText(
      makeNode({
        event: "score",
        score: { answer: "yes", explanation: "partial", value: 0.5 },
        target: null,
        intermediate: true,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toEqual([]);
  });

  test("score_edit: returns empty for score_edit events", () => {
    const texts = eventSearchText(
      makeNode({
        event: "score_edit",
        edit: { answer: "new", explanation: "fixed", provenance: null },
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toEqual([]);
  });

  test("model: includes model name", () => {
    const texts = eventSearchText(
      makeNode({
        event: "model",
        model: "gpt-4",
        role: "assistant",
        output: { choices: [] },
        input: [],
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("gpt-4");
  });

  test("model: extracts text from output choices", () => {
    const texts = eventSearchText(
      makeNode({
        event: "model",
        model: "gpt-4",
        role: null,
        output: {
          choices: [{ message: { content: "hello world", role: "assistant" } }],
        },
        input: [],
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("gpt-4");
    expect(texts).toContain("hello world");
  });

  test("step: includes name and type as separate values", () => {
    const texts = eventSearchText(
      makeNode({
        event: "step",
        name: "generate",
        type: "solver",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("generate");
    expect(texts).toContain("solver");
  });

  test("step: includes name when no type", () => {
    const texts = eventSearchText(
      makeNode({
        event: "step",
        name: "my_step",
        type: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("my_step");
  });

  test("subtask: includes name and type", () => {
    const fork = eventSearchText(
      makeNode({
        event: "subtask",
        name: "parallel",
        type: "fork",
        input: null,
        result: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(fork).toContain("parallel");
    expect(fork).toContain("fork");

    const sub = eventSearchText(
      makeNode({
        event: "subtask",
        name: "check",
        type: "subtask",
        input: null,
        result: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(sub).toContain("check");
    expect(sub).toContain("subtask");
  });

  test("tool: includes view title and function name", () => {
    const texts = eventSearchText(
      makeNode({
        event: "tool",
        function: "search",
        view: { title: "Web Search" },
        arguments: null,
        result: null,
        error: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("Web Search");
    expect(texts).toContain("search");
  });

  test("error: includes error message", () => {
    const texts = eventSearchText(
      makeNode({
        event: "error",
        error: { message: "something broke", traceback: null },
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("something broke");
  });

  test("logger: includes message and filename", () => {
    const texts = eventSearchText(
      makeNode({
        event: "logger",
        message: {
          level: "WARNING",
          message: "disk space low",
          filename: "main.py",
        },
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("disk space low");
    expect(texts).toContain("main.py");
  });

  test("info: includes source and data", () => {
    const texts = eventSearchText(
      makeNode({
        event: "info",
        source: "system",
        data: "startup complete",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("system");
    expect(texts).toContain("startup complete");
  });

  test("info: includes data without source", () => {
    const texts = eventSearchText(
      makeNode({
        event: "info",
        source: null,
        data: "startup complete",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("startup complete");
  });

  test("span_begin: includes name and type as separate values", () => {
    const texts = eventSearchText(
      makeNode({
        event: "span_begin",
        name: "evaluate",
        type: "solver",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("evaluate");
    expect(texts).toContain("solver");
  });

  test("span_begin: includes name when no type", () => {
    const texts = eventSearchText(
      makeNode({
        event: "span_begin",
        name: "init",
        type: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("init");
  });

  test("compaction: includes source and serialized event", () => {
    const texts = eventSearchText(
      makeNode({
        event: "compaction",
        source: "inspect",
        tokens_before: 1000,
        tokens_after: 500,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("inspect");
  });

  test("unknown event: returns empty array", () => {
    const texts = eventSearchText(
      makeNode({
        event: "state",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toEqual([]);
  });
});
