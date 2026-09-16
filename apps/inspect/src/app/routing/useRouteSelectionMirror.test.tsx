import { act, cleanup, renderHook } from "@testing-library/react";
import { type PropsWithChildren } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initAppConfig } from "../../app_config";
import { testClientAPI } from "../../client/api/testClientApi";
import { initializeStore, useStore } from "../../state/store";

import { useLogRouteParams } from "./url";
import {
  useRouteLogSelectionMirror,
  useRouteSelectionMirror,
} from "./useRouteSelectionMirror";

// A real store and a real (proxied, so no dir scoping) app config: the
// actions absolutize the route's log name against this dir.
const LOG_DIR = "/logs";

beforeEach(() => {
  initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
  });
  initAppConfig({
    api: testClientAPI(),
    singleFileMode: false,
    loader: "replicator",
    inspect_version: "",
    scout_version: null,
    logDir: LOG_DIR,
  });
});

afterEach(cleanup);

const useSelection = () => ({
  navigate: useNavigate(),
  selectedLogFile: useStore((state) => state.logs.selectedLogFile),
  selectedSampleHandle: useStore((state) => state.log.selectedSampleHandle),
});

const useSampleRouteMirror = () => {
  const { logPath, sampleId, epoch } = useLogRouteParams();
  useRouteSelectionMirror({ logPath, sampleId, epoch });
  return useSelection();
};

const useLogRouteMirror = () => {
  const { logPath } = useLogRouteParams();
  useRouteLogSelectionMirror(logPath);
  return useSelection();
};

const renderAt = <T,>(hook: () => T, initialRoute: string) => {
  const wrapper = ({ children }: PropsWithChildren) => (
    <MemoryRouter initialEntries={[initialRoute]}>{children}</MemoryRouter>
  );
  return renderHook(hook, { wrapper }).result;
};

const sampleRoute = (epoch: string) =>
  `/logs/run.eval/samples/sample/sample-1/${epoch}`;

describe("useRouteSelectionMirror", () => {
  it("selects the route's log (absolutized) and sample", () => {
    const result = renderAt(useSampleRouteMirror, sampleRoute("2"));

    expect(result.current.selectedLogFile).toBe("/logs/run.eval");
    expect(result.current.selectedSampleHandle).toEqual({
      id: "sample-1",
      epoch: 2,
      logFile: "/logs/run.eval",
    });
  });

  it("writes nothing while the route names no sample", () => {
    const result = renderAt(useSampleRouteMirror, "/logs/run.eval");

    expect(result.current.selectedLogFile).toBeUndefined();
    expect(result.current.selectedSampleHandle).toBeUndefined();
  });

  it("selects the log but not the sample for a malformed epoch", () => {
    const result = renderAt(useSampleRouteMirror, sampleRoute("abc"));

    expect(result.current.selectedLogFile).toBe("/logs/run.eval");
    expect(result.current.selectedSampleHandle).toBeUndefined();
  });

  it("follows the route to another sample", async () => {
    const result = renderAt(useSampleRouteMirror, sampleRoute("1"));

    await act(async () => {
      await result.current.navigate("/logs/other.eval/samples/sample/s9/3");
    });

    expect(result.current.selectedLogFile).toBe("/logs/other.eval");
    expect(result.current.selectedSampleHandle).toEqual({
      id: "s9",
      epoch: 3,
      logFile: "/logs/other.eval",
    });
  });

  it("keeps the last selection after navigating away", async () => {
    const result = renderAt(useSampleRouteMirror, sampleRoute("1"));

    await act(async () => {
      await result.current.navigate("/logs");
    });

    expect(result.current.selectedLogFile).toBe("/logs/run.eval");
    expect(result.current.selectedSampleHandle).toEqual({
      id: "sample-1",
      epoch: 1,
      logFile: "/logs/run.eval",
    });
  });
});

describe("useRouteLogSelectionMirror", () => {
  it("selects the route's log (absolutized) and leaves the sample alone", () => {
    const result = renderAt(useLogRouteMirror, "/logs/run.eval");

    expect(result.current.selectedLogFile).toBe("/logs/run.eval");
    expect(result.current.selectedSampleHandle).toBeUndefined();
  });

  it("writes nothing without a log path and keeps the last log after leaving", async () => {
    const result = renderAt(useLogRouteMirror, "/logs");
    expect(result.current.selectedLogFile).toBeUndefined();

    await act(async () => {
      await result.current.navigate("/logs/run.eval");
    });
    expect(result.current.selectedLogFile).toBe("/logs/run.eval");

    await act(async () => {
      await result.current.navigate("/logs");
    });
    expect(result.current.selectedLogFile).toBe("/logs/run.eval");
  });
});
