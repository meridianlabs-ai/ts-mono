import { compileExpression } from "filtrex";
import { expect, it, vi } from "vitest";

// Both libraries cap deprecation warnings with a module-level counter.
// `vi.resetModules` gives our evaluator a fresh one, and also runs this
// file in the isolated test project, where filtrex's loads fresh too.
it("warns about deprecated syntax exactly as filtrex does", async () => {
  vi.resetModules();
  const { compileFilterExpression } = await import("./expressionEvaluator");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const data = { t: true };
  const warningsFrom = (
    compile: (expression: string) => (data: unknown) => unknown
  ): unknown[][] => {
    warn.mockClear();
    for (let i = 0; i < 5; i++) {
      compile("t ? 1 : 2")(data);
      compile("7 % 3")(data);
    }
    return warn.mock.calls;
  };
  try {
    const theirs = warningsFrom((expression) => {
      const fn = compileExpression(expression);
      return (input) => {
        const result: unknown = fn(input);
        return result;
      };
    });
    const ours = warningsFrom(compileFilterExpression);
    expect(theirs).toHaveLength(6);
    expect(ours).toEqual(theirs);
  } finally {
    warn.mockRestore();
  }
});
