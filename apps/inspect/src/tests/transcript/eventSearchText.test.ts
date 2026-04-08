import { describe, expect, test } from "vitest";

import {
  EventNode,
  eventSearchText,
} from "@tsmono/inspect-components/transcript";

const makeNode = (event: Record<string, unknown>): EventNode => {
  return new EventNode("test-id", event as never, 0);
};

describe("eventSearchText", () => {
  test("score: includes answer, explanation, and value", () => {
    const texts = eventSearchText(
      makeNode({
        event: "score",
        score: { answer: "yes", explanation: "partial", value: 0.5 },
        target: "correct answer",
        intermediate: true,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("yes");
    expect(texts).toContain("partial");
    expect(texts).toContain("0.5");
    expect(texts).toContain("correct answer");
  });

  test("score: includes array target", () => {
    const texts = eventSearchText(
      makeNode({
        event: "score",
        score: { answer: null, explanation: null, value: 1 },
        target: ["a", "b"],
        intermediate: false,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("a");
    expect(texts).toContain("b");
  });

  test("score_edit: includes score_name and edit fields", () => {
    const texts = eventSearchText(
      makeNode({
        event: "score_edit",
        score_name: "accuracy",
        edit: {
          answer: "new answer",
          explanation: "fixed reasoning",
          provenance: null,
        },
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("accuracy");
    expect(texts).toContain("new answer");
    expect(texts).toContain("fixed reasoning");
  });

  test("score_edit: excludes UNCHANGED fields", () => {
    const texts = eventSearchText(
      makeNode({
        event: "score_edit",
        score_name: "accuracy",
        edit: {
          answer: "UNCHANGED",
          explanation: "UNCHANGED",
          provenance: null,
        },
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("accuracy");
    expect(texts).not.toContain("UNCHANGED");
  });

  test("sample_init: includes target and metadata", () => {
    const texts = eventSearchText(
      makeNode({
        event: "sample_init",
        sample: {
          target: "expected output",
          metadata: { category: "math" },
          input: "question",
        },
        state: {},
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("expected output");
    expect(texts.some((t) => t.includes("math"))).toBe(true);
  });

  test("sample_limit: includes message and type", () => {
    const texts = eventSearchText(
      makeNode({
        event: "sample_limit",
        message: "Token limit exceeded",
        type: "token",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("Token limit exceeded");
    expect(texts).toContain("token");
  });

  test("input: includes input text", () => {
    const texts = eventSearchText(
      makeNode({
        event: "input",
        input: "user typed this",
        input_ansi: "user typed this",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("user typed this");
  });

  test("approval: includes decision, explanation, and approver", () => {
    const texts = eventSearchText(
      makeNode({
        event: "approval",
        decision: "approve",
        explanation: "looks safe",
        approver: "human-in-loop",
        message: "Allow file write?",
        call: {},
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("approve");
    expect(texts).toContain("looks safe");
    expect(texts).toContain("human-in-loop");
  });

  test("sandbox: includes action, cmd, output, and file", () => {
    const texts = eventSearchText(
      makeNode({
        event: "sandbox",
        action: "exec",
        cmd: "ls -la",
        output: "total 42",
        file: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("exec");
    expect(texts).toContain("ls -la");
    expect(texts).toContain("total 42");
  });

  test("sandbox: includes file for read/write actions", () => {
    const texts = eventSearchText(
      makeNode({
        event: "sandbox",
        action: "read_file",
        cmd: null,
        output: "file contents",
        file: "/tmp/test.txt",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("read_file");
    expect(texts).toContain("/tmp/test.txt");
  });

  test("state: includes change paths and values", () => {
    const texts = eventSearchText(
      makeNode({
        event: "state",
        changes: [
          { op: "replace", path: "/messages/0/content", value: "hello" },
          { op: "add", path: "/count", value: 42 },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("/messages/0/content");
    expect(texts).toContain("hello");
    expect(texts).toContain("/count");
    expect(texts).toContain("42");
  });

  test("store: includes change paths and values", () => {
    const texts = eventSearchText(
      makeNode({
        event: "store",
        changes: [{ op: "add", path: "/key", value: "val" }],
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("/key");
    expect(texts).toContain("val");
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
        event: "span_end",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toEqual([]);
  });
});
