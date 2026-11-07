import { describe, expect, it } from "vitest";

import {
  expectEvent,
  testAssistantMessage,
  testModelCall,
  testModelEvent,
  testModelOutput,
  testStepEvent,
  testUserMessage,
} from "../testing";
import type {
  ChatMessage,
  Event,
  EventsData,
  ModelCall,
  ModelEvent,
} from "../types";

import { expandEvents } from "./expandEvents";

// -- Helpers for building test fixtures --

/** Minimal ModelEvent with condensed input_refs (no inline input). */
const makeCondensedModelEvent = (
  inputRefs: [number, number][] | null,
  callOverrides?: Partial<ModelCall>
): ModelEvent =>
  testModelEvent({
    model: "test-model",
    input: [],
    input_refs: inputRefs,
    output: testModelOutput({ model: "test-model" }),
    call: callOverrides ? testModelCall(callOverrides) : null,
  });

const makeStepEvent = (): Event => testStepEvent({ name: "test-step" });

const pool: ChatMessage[] = [
  testUserMessage({ content: "msg-0" }),
  testUserMessage({ content: "msg-1" }),
  testAssistantMessage({ content: "msg-2" }),
  testUserMessage({ content: "msg-3" }),
  testAssistantMessage({ content: "msg-4" }),
  testUserMessage({ content: "msg-5" }),
  testAssistantMessage({ content: "msg-6" }),
];

const callPool: EventsData["calls"] = [
  { role: "user", content: "call-0" },
  { role: "assistant", content: "call-1" },
  { role: "user", content: "call-2" },
  { role: "assistant", content: "call-3" },
  { role: "user", content: "call-4" },
];

describe("expandEvents", () => {
  it("returns events unchanged when eventsData is null", () => {
    const events: Event[] = [makeCondensedModelEvent(null)];
    const result = expandEvents(events, null);
    expect(result).toBe(events);
  });

  it("returns events unchanged when pools are empty", () => {
    const events: Event[] = [makeCondensedModelEvent([[0, 2]])];
    const eventsData: EventsData = { messages: [], calls: [] };
    const result = expandEvents(events, eventsData);
    expect(result).toBe(events);
  });

  it("passes non-ModelEvents through untouched", () => {
    const step = makeStepEvent();
    const eventsData: EventsData = { messages: pool, calls: [] };
    const result = expandEvents([step], eventsData);
    expect(result[0]).toBe(step);
  });

  it("returns ModelEvent unchanged when it has no refs", () => {
    const event = makeCondensedModelEvent(null);
    const eventsData: EventsData = { messages: pool, calls: [] };
    const result = expandEvents([event], eventsData);
    expect(result[0]).toBe(event);
  });

  it("expands input_refs from message pool", () => {
    const event = makeCondensedModelEvent([[0, 3]]);
    const eventsData: EventsData = { messages: pool, calls: [] };
    const result = expandEvents([event], eventsData);
    const expanded = expectEvent(result[0], "model");

    expect(expanded.input).toEqual([pool[0], pool[1], pool[2]]);
    expect(expanded.input_refs).toBeNull();
  });

  it("expands multiple non-contiguous input_refs ranges", () => {
    const event = makeCondensedModelEvent([
      [0, 2],
      [5, 7],
    ]);
    const eventsData: EventsData = { messages: pool, calls: [] };
    const result = expandEvents([event], eventsData);
    const expanded = expectEvent(result[0], "model");

    expect(expanded.input).toEqual([pool[0], pool[1], pool[5], pool[6]]);
    expect(expanded.input_refs).toBeNull();
  });

  it("expands call_refs from call pool using default key 'messages'", () => {
    const event = makeCondensedModelEvent(null, {
      call_refs: [[0, 3]],
      call_key: null,
      request: { model: "gpt-4" },
    });
    const eventsData: EventsData = { messages: [], calls: callPool };
    const result = expandEvents([event], eventsData);
    const expanded = expectEvent(result[0], "model");

    expect(expanded.call?.request).toEqual({
      model: "gpt-4",
      messages: [callPool[0], callPool[1], callPool[2]],
    });
    expect(expanded.call?.call_refs).toBeNull();
    expect(expanded.call?.call_key).toBeNull();
  });

  it("expands call_refs using custom call_key", () => {
    const event = makeCondensedModelEvent(null, {
      call_refs: [[1, 4]],
      call_key: "contents",
      request: { model: "gemini" },
    });
    const eventsData: EventsData = { messages: [], calls: callPool };
    const result = expandEvents([event], eventsData);
    const expanded = expectEvent(result[0], "model");

    expect(expanded.call?.request).toEqual({
      model: "gemini",
      contents: [callPool[1], callPool[2], callPool[3]],
    });
    expect(expanded.call?.call_refs).toBeNull();
    expect(expanded.call?.call_key).toBeNull();
  });

  it("expands both input_refs and call_refs in the same event", () => {
    const event = makeCondensedModelEvent([[0, 2]], {
      call_refs: [[0, 2]],
      call_key: null,
      request: {},
    });
    const eventsData: EventsData = { messages: pool, calls: callPool };
    const result = expandEvents([event], eventsData);
    const expanded = expectEvent(result[0], "model");

    expect(expanded.input).toEqual([pool[0], pool[1]]);
    expect(expanded.input_refs).toBeNull();
    expect(expanded.call?.request).toEqual({
      messages: [callPool[0], callPool[1]],
    });
    expect(expanded.call?.call_refs).toBeNull();
  });

  it("handles mixed event types preserving order", () => {
    const step = makeStepEvent();
    const model = makeCondensedModelEvent([[0, 1]]);
    const events: Event[] = [step, model, step];
    const eventsData: EventsData = { messages: pool, calls: [] };

    const result = expandEvents(events, eventsData);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(step);
    expect(expectEvent(result[1], "model").input).toEqual([pool[0]]);
    expect(result[2]).toBe(step);
  });

  it("handles single-element ranges", () => {
    const event = makeCondensedModelEvent([
      [2, 3],
      [5, 6],
    ]);
    const eventsData: EventsData = { messages: pool, calls: [] };
    const result = expandEvents([event], eventsData);
    const expanded = expectEvent(result[0], "model");

    expect(expanded.input).toEqual([pool[2], pool[5]]);
  });

  it("does not mutate original events", () => {
    const event = makeCondensedModelEvent([[0, 2]]);
    const eventsData: EventsData = { messages: pool, calls: [] };
    expandEvents([event], eventsData);

    expect(event.input).toEqual([]);
    expect(event.input_refs).toEqual([[0, 2]]);
  });
});
