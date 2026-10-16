import { from } from "arquero";
import { http, HttpResponse } from "msw";

import { encodeBase64Url } from "@tsmono/util";

import type { Status } from "../src/types/api-types";

import { expect, test } from "./fixtures/app";
import { createStatus } from "./fixtures/test-data";

// The policy a host serving Scout behind its own CSP was seen sending: no
// 'unsafe-eval', so anything that evaluates a string as code throws.
const kHostPolicy = "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'";

declare global {
  interface Window {
    __cspViolations: string[];
  }
}

// Its own looser host policy replaces the viewer's, and it probes eval on
// purpose, so it asserts its own violations instead of the fixture's.
test.use({ allowCspViolations: true });

test("scan results load under a host CSP without 'unsafe-eval'", async ({
  page,
  network,
}) => {
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-security-policy": kHostPolicy,
        },
      });
    }
  );
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push(
        `${event.effectiveDirective} ${event.blockedURI}`
      );
    });
  });

  const rows = from([
    {
      uuid: "result-plain",
      transcript_id: "transcript-plain",
      value: "3",
      value_type: "number",
      explanation: "plain explanation",
      scan_error_refusal: "false",
      metadata: "{}",
      transcript_metadata: "{}",
    },
    {
      uuid: "result-set",
      transcript_id: "transcript-set",
      value: JSON.stringify([
        {
          uuid: "label-a",
          label: "alpha",
          value: true,
          explanation: "alpha explanation",
        },
        {
          uuid: "label-b",
          label: "beta",
          value: 2,
          explanation: "beta explanation",
        },
      ]),
      value_type: "resultset",
      explanation: null,
      scan_error_refusal: "false",
      metadata: "{}",
      transcript_metadata: "{}",
    },
  ]);
  network.use(
    http.get("*/api/v2/scans/:dir/:scanPath", () =>
      HttpResponse.json<Status>(
        createStatus({
          summary: {
            complete: true,
            scanners: {
              labels: {
                scans: 2,
                results: 3,
                tokens: 0,
                errors: 0,
                model_usage: {},
              },
            },
          },
        })
      )
    ),
    http.get("*/api/v2/scans/:dir/:scanPath/labels", () =>
      HttpResponse.arrayBuffer(Uint8Array.from(rows.toArrowIPC()).buffer)
    ),
    http.get("*/api/v2/scans/:dir/:scanPath/labels/:uuid", () =>
      HttpResponse.json({
        input_type: "message",
        input: { id: "m-1", role: "assistant", content: "scanned message" },
      })
    )
  );

  const dir = encodeBase64Url("/home/test/project/.scans");
  await page.goto(
    `/#/scan/${dir}/scan_id=aBcDeFgHiJkLmNoPqRsTuV?scanner=labels`
  );

  // List view: summaries for the plain row and each expanded resultset row.
  await expect(page.locator("#scanner-panel-footer")).toContainText(
    "3 results"
  );

  await page.getByRole("button", { name: /dataframe/ }).click();
  const grid = page.getByRole("grid", { name: "Scanner results" });
  const expanded = grid.getByRole("gridcell", {
    name: "beta explanation",
    exact: true,
  });
  await expect(expanded).toBeVisible();

  // Result detail filters the dataframe to the chosen row.
  await expanded.dblclick();
  await expect(page).toHaveURL(/\/label-b\?/);
  await expect(page.getByText("scanned message")).toBeVisible();
  await expect(page.getByText("beta explanation")).toBeVisible();

  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);

  // The policy was in force all along: a document's CSP can't loosen. Code on
  // page.evaluate's own stack is exempt from it, so the probe is an inline
  // script that tries eval in a later task.
  await page.evaluate(() => {
    const probe = document.createElement("script");
    probe.textContent = `setTimeout(() => {
      try {
        new Function("return 1");
        document.body.dataset.evalProbe = "allowed";
      } catch (e) {
        document.body.dataset.evalProbe = e.name;
      }
    });`;
    document.head.append(probe);
  });
  await expect(page.locator("body")).toHaveAttribute(
    "data-eval-probe",
    "EvalError"
  );
});
