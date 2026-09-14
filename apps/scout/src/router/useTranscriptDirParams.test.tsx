// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { type PropsWithChildren } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { encodeBase64Url } from "@tsmono/util";

import { createTestWrapperWithStore } from "../test/test-utils";

import { kTranscriptDetailRoute, kTranscriptsRouteUrlPattern } from "./url";
import { useTranscriptDirParams } from "./useTranscriptDirParams";

afterEach(cleanup);

const transcriptsDir = "/mnt/logs/transcripts";

const renderAt = (initialRoute: string) => {
  const { wrapper: Providers, store } = createTestWrapperWithStore();
  const wrapper = ({ children }: PropsWithChildren) => (
    <Providers>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path={kTranscriptDetailRoute} element={children} />
          <Route path={kTranscriptsRouteUrlPattern} element={children} />
        </Routes>
      </MemoryRouter>
    </Providers>
  );
  const { result } = renderHook(
    () => ({ dir: useTranscriptDirParams(), navigate: useNavigate() }),
    { wrapper }
  );
  return { result, store };
};

describe("useTranscriptDirParams", () => {
  it("decodes the route directory and mirrors it into the store", () => {
    const { result, store } = renderAt(
      `/transcripts/${encodeBase64Url(transcriptsDir)}/transcript-1`
    );

    expect(result.current.dir).toBe(transcriptsDir);
    expect(store.getState().userTranscriptsDir).toBe(transcriptsDir);
  });

  it("treats a malformed directory segment as absent", () => {
    const { result, store } = renderAt("/transcripts/not!valid/transcript-1");

    expect(result.current.dir).toBeUndefined();
    expect(store.getState().userTranscriptsDir).toBeUndefined();
  });

  it("returns undefined and leaves the store alone without a param", () => {
    const { result, store } = renderAt("/transcripts");

    expect(result.current.dir).toBeUndefined();
    expect(store.getState().userTranscriptsDir).toBeUndefined();
  });

  it("keeps the last route directory in the store after leaving the route", async () => {
    const { result, store } = renderAt(
      `/transcripts/${encodeBase64Url(transcriptsDir)}/transcript-1`
    );

    await act(async () => {
      await result.current.navigate("/transcripts");
    });

    expect(result.current.dir).toBeUndefined();
    expect(store.getState().userTranscriptsDir).toBe(transcriptsDir);
  });
});
