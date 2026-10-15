import { expect, test } from "./fixtures/app";

// The cspViolations fixture fails any spec whose page reports a violation,
// but a page served with no policy reports none either. This pins that the
// preview build, like `scout view`, serves the policy the build wrote.
test("the preview serves the built policy file as its header", async ({
  request,
}) => {
  const response = await request.get("/");
  // Delivered by the host (here as a header), never baked into index.html,
  // where it would also bind hosts that can't strip it (VS Code).
  expect(await response.text()).not.toContain("Content-Security-Policy");
  const header = response.headers()["content-security-policy"] ?? "";
  expect(header).toContain("default-src 'none'");
  expect(header).not.toContain("'unsafe-eval'");

  const file: unknown = await (
    await request.get("/content-security-policy.json")
  ).json();
  expect(file).toMatchObject({ version: 1 });
  expect(policyFileDirectives(file).join("; ")).toBe(header);
});

const isDirectives = (value: unknown): value is Record<string, string[]> =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every(
    (sources) =>
      Array.isArray(sources) &&
      sources.every((source) => typeof source === "string")
  );

/** The policy file's directives as `name sources…` strings, in file order. */
const policyFileDirectives = (file: unknown): string[] =>
  typeof file === "object" &&
  file !== null &&
  "directives" in file &&
  isDirectives(file.directives)
    ? Object.entries(file.directives).map(([name, sources]) =>
        [name, ...sources].join(" ")
      )
    : [];
