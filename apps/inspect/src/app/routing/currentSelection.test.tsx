// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  testClientAPI,
  testLogDetails,
  testSampleSummary,
} from "../../client/api/testClientApi";
import { storeImplementation } from "../../state/store";
import { startTestApp, stopTestApp, TestApp } from "../../test/testApp";

import {
  currentSample,
  CurrentSelectionProvider,
  routeLogFile,
  useCurrentLogFile,
  useCurrentSampleHandle,
} from "./currentSelection";
import { selectionRouteParams } from "./routeParams";

beforeEach(() => {
  // A log named single.eval holds one sample; every other log is empty.
  startTestApp({
    logDir: "file:///logs",
    api: testClientAPI({
      get_log_details: (file) =>
        Promise.resolve(
          testLogDetails({
            sampleSummaries: file.endsWith("single.eval")
              ? [testSampleSummary({ id: "only", epoch: 1 })]
              : [],
          })
        ),
    }),
  });
});
afterEach(async () => {
  cleanup();
  await stopTestApp();
});

const highlighted = () => storeImplementation?.getState().log.highlightedSample;

function Probe() {
  const file = useCurrentLogFile();
  const sample = useCurrentSampleHandle();
  return <output>{JSON.stringify({ file, sample })}</output>;
}
function open(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <CurrentSelectionProvider>
            <Probe />
          </CurrentSelectionProvider>
        ),
      },
    ],
    { initialEntries: [path] }
  );
  render(
    <TestApp>
      <RouterProvider router={router} />
    </TestApp>
  );
  return router;
}

describe("route-owned selection", () => {
  it.each([
    "/logs/run.eval/samples/sample/ascii%2Fbike/2",
    "/tasks/run.eval/samples/sample/ascii%2Fbike/2",
    "/samples/run.eval/sample/ascii%2Fbike/2",
  ])("resolves %s without a store selection", (path) => {
    open(path);
    expect(screen.getByRole("status").textContent).toBe(
      JSON.stringify({
        file: "file:///logs/run.eval",
        sample: {
          logFile: "file:///logs/run.eval",
          id: "ascii/bike",
          epoch: 2,
        },
      })
    );
    expect(highlighted()).toMatchObject({
      id: "ascii/bike",
      epoch: 2,
      logFile: "file:///logs/run.eval",
    });
  });
  it("changes both identities on navigation and Back, and releases them on the list", async () => {
    const router = open("/logs/run.eval/samples/sample/one/1");
    await act(async () => {
      await router.navigate("/logs/next.eval/samples/sample/two/3");
    });
    expect(screen.getByRole("status").textContent).toContain('"id":"two"');
    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByRole("status").textContent).toContain('"id":"one"');
    await act(async () => {
      await router.navigate("/logs");
    });
    expect(screen.getByRole("status").textContent).toBe("{}");
    // Leaving detail preserves historical highlighting without keeping it active.
    expect(highlighted()).toMatchObject({
      id: "one",
      epoch: 1,
      logFile: "file:///logs/run.eval",
    });
  });
  it("derives an inline single sample from summaries", async () => {
    open("/logs/single.eval/samples/messages");
    // The summaries arrive through the engine's details fetch.
    expect(
      await screen.findByText(/"id":"only"/, { selector: "output" })
    ).toBeInTheDocument();
  });
  it.each(["/logs/team", "/samples/archive.eval", "/logs/workflow.yaml", "/"])(
    "does not treat collection/flow route %s as a log",
    (path) => {
      expect(routeLogFile(path, selectionRouteParams(path))).toBeUndefined();
    }
  );
  it("does not fall back to an inline sample for an invalid explicit destination", () => {
    const summaries = [{ id: "only", epoch: 1 }];
    for (const route of [
      "/logs/single.eval/samples/sample/one/invalid",
      "/logs/single.eval/samples/sample_uuid/unknown",
    ]) {
      expect(
        currentSample("single.eval", selectionRouteParams(route), summaries)
      ).toBeUndefined();
    }
  });
  it("leaves a multi-sample list without an active sample", () => {
    expect(
      currentSample("multi.eval", selectionRouteParams("/logs/multi.eval"), [
        { id: "one", epoch: 1 },
        { id: "two", epoch: 1 },
      ])
    ).toBeUndefined();
  });
});
