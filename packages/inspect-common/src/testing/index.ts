/**
 * Cast-free test fixtures for the generated log types.
 *
 * Each builder returns a fully-typed minimal value with every required field
 * populated, spread-merged with the caller's overrides. Tests should use
 * these instead of `as unknown as X` casts on partial literals — fixtures
 * break loudly (at typecheck) when the generated types move, casts don't.
 */
import type {
  ApprovalEvent,
  ChatCompletionChoice,
  ChatMessageAssistant,
  ChatMessageSystem,
  ChatMessageTool,
  ChatMessageUser,
  CompactionEvent,
  ErrorEvent,
  EvalError,
  EvalLog,
  EvalMetric,
  EvalPlan,
  EvalResults,
  EvalSample,
  EvalScore,
  EvalSpec,
  EvalStats,
  InfoEvent,
  InputEvent,
  LoggerEvent,
  ModelEvent,
  ModelOutput,
  ModelUsage,
  SampleInitEvent,
  SampleLimitEvent,
  SandboxEvent,
  Score,
  ScoreEvent,
  SpanBeginEvent,
  SpanEndEvent,
  StateEvent,
  StepEvent,
  StoreEvent,
  SubtaskEvent,
  ToolCall,
  ToolEvent,
} from "../types";

/** Fixed timestamp so fixtures are deterministic; override where timing matters. */
export const TEST_TIMESTAMP = "2025-01-15T10:00:00.000Z";

// ---------------------------------------------------------------------------
// Chat messages
// ---------------------------------------------------------------------------

export const testSystemMessage = (
  overrides: Partial<ChatMessageSystem> = {}
): ChatMessageSystem => ({
  role: "system",
  content: "You are a helpful assistant.",
  ...overrides,
});

export const testUserMessage = (
  overrides: Partial<ChatMessageUser> = {}
): ChatMessageUser => ({
  role: "user",
  content: "Hello",
  ...overrides,
});

export const testAssistantMessage = (
  overrides: Partial<ChatMessageAssistant> = {}
): ChatMessageAssistant => ({
  role: "assistant",
  content: "Hi there",
  ...overrides,
});

export const testToolMessage = (
  overrides: Partial<ChatMessageTool> = {}
): ChatMessageTool => ({
  role: "tool",
  content: "tool result",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

export const testModelUsage = (
  overrides: Partial<ModelUsage> = {}
): ModelUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  ...overrides,
});

export const testChatCompletionChoice = (
  overrides: Partial<ChatCompletionChoice> = {}
): ChatCompletionChoice => ({
  message: testAssistantMessage(),
  stop_reason: "stop",
  ...overrides,
});

export const testModelOutput = (
  overrides: Partial<ModelOutput> = {}
): ModelOutput => ({
  model: "test-model",
  completion: "",
  choices: [],
  ...overrides,
});

export const testToolCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  id: "call_1",
  function: "test_tool",
  arguments: {},
  type: "function",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const testModelEvent = (
  overrides: Partial<ModelEvent> = {}
): ModelEvent => ({
  event: "model",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  model: "test-model",
  input: [],
  tools: [],
  tool_choice: "auto",
  config: {},
  output: testModelOutput(),
  ...overrides,
});

export const testToolEvent = (
  overrides: Partial<ToolEvent> = {}
): ToolEvent => ({
  event: "tool",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  id: "call_1",
  type: "function",
  function: "test_tool",
  arguments: {},
  result: "",
  events: [],
  ...overrides,
});

export const testSpanBeginEvent = (
  overrides: Partial<SpanBeginEvent> = {}
): SpanBeginEvent => ({
  event: "span_begin",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  id: "span_1",
  name: "span",
  ...overrides,
});

export const testSpanEndEvent = (
  overrides: Partial<SpanEndEvent> = {}
): SpanEndEvent => ({
  event: "span_end",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  id: "span_1",
  ...overrides,
});

export const testStateEvent = (
  overrides: Partial<StateEvent> = {}
): StateEvent => ({
  event: "state",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  changes: [],
  ...overrides,
});

export const testStoreEvent = (
  overrides: Partial<StoreEvent> = {}
): StoreEvent => ({
  event: "store",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  changes: [],
  ...overrides,
});

export const testInfoEvent = (
  overrides: Partial<InfoEvent> = {}
): InfoEvent => ({
  event: "info",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  data: {},
  ...overrides,
});

export const testScore = (overrides: Partial<Score> = {}): Score => ({
  value: 1,
  history: [],
  ...overrides,
});

export const testScoreEvent = (
  overrides: Partial<ScoreEvent> = {}
): ScoreEvent => ({
  event: "score",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  intermediate: false,
  score: testScore(),
  ...overrides,
});

export const testEvalError = (
  overrides: Partial<EvalError> = {}
): EvalError => ({
  message: "test error",
  traceback: "",
  traceback_ansi: "",
  ...overrides,
});

export const testErrorEvent = (
  overrides: Partial<ErrorEvent> = {}
): ErrorEvent => ({
  event: "error",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  error: testEvalError(),
  ...overrides,
});

export const testSampleInitEvent = (
  overrides: Partial<SampleInitEvent> = {}
): SampleInitEvent => ({
  event: "sample_init",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  sample: { input: "test input", target: "test target" },
  state: {},
  ...overrides,
});

export const testSampleLimitEvent = (
  overrides: Partial<SampleLimitEvent> = {}
): SampleLimitEvent => ({
  event: "sample_limit",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  type: "token",
  message: "limit reached",
  ...overrides,
});

export const testCompactionEvent = (
  overrides: Partial<CompactionEvent> = {}
): CompactionEvent => ({
  event: "compaction",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  type: "summary",
  ...overrides,
});

export const testLoggerEvent = (
  overrides: Partial<LoggerEvent> = {}
): LoggerEvent => ({
  event: "logger",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  message: {
    name: "logger",
    level: "info",
    message: "log message",
    created: 0,
    filename: "test.py",
    module: "test",
    lineno: 1,
  },
  ...overrides,
});

export const testStepEvent = (
  overrides: Partial<StepEvent> = {}
): StepEvent => ({
  event: "step",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  action: "begin",
  name: "step",
  ...overrides,
});

export const testSubtaskEvent = (
  overrides: Partial<SubtaskEvent> = {}
): SubtaskEvent => ({
  event: "subtask",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  name: "subtask",
  input: {},
  result: null,
  events: [],
  ...overrides,
});

export const testApprovalEvent = (
  overrides: Partial<ApprovalEvent> = {}
): ApprovalEvent => ({
  event: "approval",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  approver: "test-approver",
  call: testToolCall(),
  decision: "approve",
  message: "",
  ...overrides,
});

export const testSandboxEvent = (
  overrides: Partial<SandboxEvent> = {}
): SandboxEvent => ({
  event: "sandbox",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  action: "exec",
  ...overrides,
});

export const testInputEvent = (
  overrides: Partial<InputEvent> = {}
): InputEvent => ({
  event: "input",
  timestamp: TEST_TIMESTAMP,
  working_start: 0,
  input: "",
  input_ansi: "",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

export const testEvalSample = (
  overrides: Partial<EvalSample> = {}
): EvalSample => ({
  id: "sample_1",
  epoch: 1,
  input: "test input",
  target: "test target",
  messages: [],
  events: [],
  output: testModelOutput(),
  metadata: {},
  store: {},
  attachments: {},
  model_usage: {},
  role_usage: {},
  ...overrides,
});

// ---------------------------------------------------------------------------
// Eval log
// ---------------------------------------------------------------------------

export const testEvalSpec = (overrides: Partial<EvalSpec> = {}): EvalSpec => ({
  eval_id: "eval_1",
  run_id: "run_1",
  created: TEST_TIMESTAMP,
  task: "test_task",
  task_id: "task_1",
  task_version: 0,
  task_args: {},
  task_args_passed: {},
  task_attribs: {},
  dataset: {},
  model: "test-model",
  model_args: {},
  model_generate_config: {},
  config: {},
  packages: {},
  ...overrides,
});

export const testEvalPlan = (overrides: Partial<EvalPlan> = {}): EvalPlan => ({
  name: "plan",
  steps: [],
  config: {},
  ...overrides,
});

export const testEvalStats = (
  overrides: Partial<EvalStats> = {}
): EvalStats => ({
  started_at: "",
  completed_at: "",
  model_usage: {},
  role_usage: {},
  connection_limit_history: [],
  ...overrides,
});

export const testEvalMetric = (
  overrides: Partial<EvalMetric> = {}
): EvalMetric => ({
  name: "accuracy",
  value: 0,
  params: {},
  ...overrides,
});

export const testEvalScore = (
  overrides: Partial<EvalScore> = {}
): EvalScore => ({
  name: "test-scorer",
  scorer: "test-scorer",
  metrics: {},
  params: {},
  ...overrides,
});

export const testEvalResults = (
  overrides: Partial<EvalResults> = {}
): EvalResults => ({
  total_samples: 0,
  completed_samples: 0,
  scores: [],
  ...overrides,
});

export const testEvalLog = (overrides: Partial<EvalLog> = {}): EvalLog => ({
  version: 2,
  status: "started",
  eval: testEvalSpec(),
  plan: testEvalPlan(),
  stats: testEvalStats(),
  tags: [],
  metadata: {},
  invalidated: false,
  ...overrides,
});
