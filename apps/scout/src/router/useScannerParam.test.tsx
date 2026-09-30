// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { type PropsWithChildren } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { createTestWrapperWithStore } from "../test/test-utils";

import { useScannerParam } from "./useScannerParam";

afterEach(cleanup);

const renderAt = (initialRoute: string) => {
  const { wrapper: Providers, store } = createTestWrapperWithStore();
  const wrapper = ({ children }: PropsWithChildren) => (
    <Providers>
      <MemoryRouter initialEntries={[initialRoute]}>{children}</MemoryRouter>
    </Providers>
  );
  const { result } = renderHook(
    () => ({ scanner: useScannerParam(), navigate: useNavigate() }),
    { wrapper }
  );
  return { result, store };
};

describe("useScannerParam", () => {
  it("reads ?scanner= and mirrors it into the store", () => {
    const { result, store } = renderAt("/scan/dir/path?scanner=toxicity");

    expect(result.current.scanner).toBe("toxicity");
    expect(store.getState().selectedScanner).toBe("toxicity");
  });

  it("returns undefined and leaves the store alone without the param", () => {
    const { result, store } = renderAt("/scan/dir/path");

    expect(result.current.scanner).toBeUndefined();
    expect(store.getState().selectedScanner).toBeUndefined();
  });

  it("treats an empty ?scanner= as absent", () => {
    const { result, store } = renderAt("/scan/dir/path?scanner=");

    expect(result.current.scanner).toBeUndefined();
    expect(store.getState().selectedScanner).toBeUndefined();
  });

  it("keeps the last scanner in the store after the param is dropped", async () => {
    const { result, store } = renderAt("/scan/dir/path?scanner=toxicity");

    await act(async () => {
      await result.current.navigate("/scan/dir/path");
    });

    expect(result.current.scanner).toBeUndefined();
    expect(store.getState().selectedScanner).toBe("toxicity");
  });
});
