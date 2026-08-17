/**
 * Cast-free descriptor fixtures: complete typed values with every member
 * stubbed to throw, spread-merged with per-test overrides.
 */
import type { SamplesDescriptor } from "./samplesDescriptor";
import type { EvalDescriptor, MessageShape, ScoreDescriptor } from "./types";

const notImplemented = (name: string) => (): never => {
  throw new Error(`${name} not implemented in test`);
};

export const testScoreDescriptor = (
  overrides: Partial<ScoreDescriptor> = {}
): ScoreDescriptor => ({
  scoreType: "other",
  compare: notImplemented("compare"),
  render: notImplemented("render"),
  ...overrides,
});

export const testEvalDescriptor = (
  overrides: Partial<EvalDescriptor> = {}
): EvalDescriptor => ({
  scores: [],
  scoreDescriptor: notImplemented("scoreDescriptor"),
  scorerDescriptor: notImplemented("scorerDescriptor"),
  score: notImplemented("score"),
  scoreAnswer: notImplemented("scoreAnswer"),
  ...overrides,
});

export const testMessageShape = (
  overrides: Partial<MessageShape> = {}
): MessageShape => ({
  idSize: 0,
  inputSize: 0,
  targetSize: 0,
  answerSize: 0,
  limitSize: 0,
  retriesSize: 0,
  fallbacksSize: 0,
  errorSize: 0,
  ...overrides,
});

export const testSamplesDescriptor = (
  overrides: Partial<SamplesDescriptor> = {}
): SamplesDescriptor => ({
  evalDescriptor: testEvalDescriptor(),
  messageShape: testMessageShape(),
  selectedScore: notImplemented("selectedScore"),
  selectedScorerDescriptor: notImplemented("selectedScorerDescriptor"),
  ...overrides,
});
