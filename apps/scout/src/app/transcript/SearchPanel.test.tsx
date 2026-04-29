// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { forwardRef, type PropsWithChildren } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComponentIconProvider } from "@tsmono/react/components";
import { encodeBase64Url } from "@tsmono/util";

import { apiScoutServer } from "../../api/api-scout-server";
import { ApplicationIcons } from "../../icons";
import { ApiProvider, createStore, StoreProvider } from "../../state/store";
import { useUserSettings } from "../../state/userSettings";
import { server } from "../../test/setup-msw";
import type {
  ProjectConfig,
  Result,
  SearchInputListResponse,
} from "../../types/api-types";

import { SearchPanel } from "./SearchPanel";
import {
  createInitialSearchPanelState,
  getSearchPanelStateKey,
  type GrepSearchPanelState,
  type LlmSearchPanelState,
  type SearchPanelState,
} from "./searchPanelState";

// VscodeTextarea is a custom element backed by ElementInternals, which jsdom
// doesn't fully implement (`_internals.setValidity` is missing). Stub it with
// a plain textarea so renders don't blow up. Behavior we care about (query
// state, submit, type toggle) is exercised through the surrounding form.
vi.mock("@vscode-elements/react-elements", async () => {
  const actual = await vi.importActual<
    typeof import("@vscode-elements/react-elements")
  >("@vscode-elements/react-elements");
  type StubProps = {
    value?: string;
    onInput?: (e: Event) => void;
    placeholder?: string;
    rows?: number;
  };
  const VscodeTextareaStub = forwardRef<HTMLTextAreaElement, StubProps>(
    function VscodeTextareaStub({ value, onInput, placeholder, rows }, ref) {
      return (
        <textarea
          ref={ref}
          value={value ?? ""}
          placeholder={placeholder}
          rows={rows}
          onInput={(e) => onInput?.(e.nativeEvent)}
          onChange={() => {}}
          data-testid="search-textarea"
        />
      );
    }
  );
  return { ...actual, VscodeTextarea: VscodeTextareaStub };
});

const transcriptDir = "/tmp/transcripts";
const transcriptId = "sample-transcript";

const minimalIcons = {
  chevronDown: ApplicationIcons.chevron.down,
  chevronUp: ApplicationIcons.collapse.up,
  clearText: ApplicationIcons["clear-text"],
  close: ApplicationIcons.close,
  code: ApplicationIcons.code,
  confirm: ApplicationIcons.confirm,
  copy: ApplicationIcons.copy,
  error: ApplicationIcons.error,
  menu: ApplicationIcons.threeDots,
  next: ApplicationIcons.next,
  noSamples: ApplicationIcons.noSamples,
  play: ApplicationIcons.play,
  previous: ApplicationIcons.previous,
  toggleRight: ApplicationIcons["toggle-right"],
};

const projectConfig = (model: string | null): ProjectConfig => ({
  filter: [],
  model,
});

const emptyRecentSearches: SearchInputListResponse = { items: [] };

type RenderOptions = {
  scope?: "events" | "messages";
  initialState?: SearchPanelState;
  projectModel?: string | null;
  recentSearches?: SearchInputListResponse;
};

const renderSearchPanel = ({
  scope = "events",
  initialState,
  projectModel = null,
  recentSearches = emptyRecentSearches,
}: RenderOptions = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const api = apiScoutServer();
  const store = createStore(api);

  if (initialState) {
    store
      .getState()
      .setSearchPanelState(
        getSearchPanelStateKey({ scope, transcriptDir, transcriptId }),
        initialState
      );
  }

  // Default handlers used by every test. Tests that need to assert request
  // bodies override these with `server.use(...)` before triggering the action.
  server.use(
    http.get("/api/v2/project/config", () =>
      HttpResponse.json(projectConfig(projectModel), {
        headers: { ETag: '"etag-1"' },
      })
    ),
    http.get("/api/v2/searches", () =>
      HttpResponse.json<SearchInputListResponse>(recentSearches)
    )
  );

  const route = `/transcripts/${encodeBase64Url(transcriptDir)}/${transcriptId}`;

  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={api}>
        <StoreProvider value={store}>
          <ComponentIconProvider icons={minimalIcons}>
            <MemoryRouter initialEntries={[route]}>
              <Routes>
                <Route
                  path="/transcripts/:transcriptsDir/:transcriptId"
                  element={children}
                />
              </Routes>
            </MemoryRouter>
          </ComponentIconProvider>
        </StoreProvider>
      </ApiProvider>
    </QueryClientProvider>
  );

  const utils = render(
    <SearchPanel
      scope={scope}
      transcriptDir={transcriptDir}
      transcriptId={transcriptId}
      onClose={() => {}}
    />,
    { wrapper: Wrapper }
  );

  return { ...utils, store };
};

type SearchPanelStateOverrides = {
  searchType?: SearchPanelState["searchType"];
  searches?: {
    grep?: Partial<GrepSearchPanelState>;
    llm?: Partial<LlmSearchPanelState>;
  };
};

const buildState = (
  overrides: SearchPanelStateOverrides = {}
): SearchPanelState => {
  const base = createInitialSearchPanelState();
  return {
    ...base,
    ...overrides,
    searches: {
      grep: { ...base.searches.grep, ...overrides.searches?.grep },
      llm: { ...base.searches.llm, ...overrides.searches?.llm },
    },
  };
};

const seededGrepResult = (value: number): Result => ({
  value,
  references: [],
});

const getRunButton = (): HTMLButtonElement =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Run" });

describe("SearchPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("submits a grep search with the right scope and renders the match count", async () => {
    let capturedBody: unknown;
    server.use(
      http.post("/api/v2/transcripts/:dir/:id/search", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json<Result>(seededGrepResult(3));
      })
    );

    renderSearchPanel({
      scope: "messages",
      initialState: buildState({
        searchType: "grep",
        searches: {
          grep: {
            query: "needle",
            grepOptions: {
              ignoreCase: false,
              regex: true,
              wordBoundary: true,
            },
          },
        },
      }),
    });

    fireEvent.click(getRunButton());

    await waitFor(() => {
      expect(screen.queryByText("3 matches")).not.toBeNull();
    });

    expect(capturedBody).toEqual({
      ignore_case: false,
      messages: "all",
      query: "needle",
      regex: true,
      type: "grep",
      word_boundary: true,
    });
  });

  it("falls back to the project model when LLM model is empty and records it on success", async () => {
    useUserSettings.setState({
      dataframeColumnPresets: [],
      searchModelHistory: [],
    });

    let capturedBody: { model?: string | null } | undefined;
    server.use(
      http.post("/api/v2/transcripts/:dir/:id/search", async ({ request }) => {
        capturedBody = (await request.json()) as { model?: string | null };
        return HttpResponse.json<Result>({ value: 1, references: [] });
      })
    );

    renderSearchPanel({
      projectModel: "project-default-model",
      initialState: buildState({
        searchType: "llm",
        searches: {
          llm: { query: "What happened?", model: "" },
        },
      }),
    });

    // Project config loads asynchronously; wait until its model surfaces as the
    // model input's placeholder before submitting, otherwise the fallback would
    // see undefined.
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText("project-default-model")
      ).not.toBeNull()
    );

    fireEvent.click(getRunButton());

    await waitFor(() => {
      expect(capturedBody?.model).toBe("project-default-model");
    });

    await waitFor(() => {
      expect(useUserSettings.getState().searchModelHistory).toEqual([
        "project-default-model",
      ]);
    });
  });

  it("preserves separate query state across grep/llm toggle", () => {
    const { store } = renderSearchPanel({
      initialState: buildState({
        searchType: "grep",
        searches: {
          grep: { query: "grep-text" },
          llm: { query: "llm-question" },
        },
      }),
    });

    const stateKey = getSearchPanelStateKey({
      scope: "events",
      transcriptDir,
      transcriptId,
    });

    fireEvent.click(screen.getByRole("button", { name: "LLM" }));
    expect(store.getState().searchPanelStates[stateKey]?.searchType).toBe(
      "llm"
    );

    fireEvent.click(screen.getByRole("button", { name: "Grep" }));
    const stored = store.getState().searchPanelStates[stateKey];
    expect(stored?.searchType).toBe("grep");
    // Both branches retained their queries across toggles.
    expect(stored?.searches.grep.query).toBe("grep-text");
    expect(stored?.searches.llm.query).toBe("llm-question");
  });

  it("resets state when New search is clicked", () => {
    const { store } = renderSearchPanel({
      initialState: buildState({
        searchType: "grep",
        searches: {
          grep: {
            query: "stale",
            hasSearched: true,
            currentSearch: seededGrepResult(7),
          },
          llm: { query: "lingering" },
        },
      }),
    });

    expect(screen.queryByText("7 matches")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New search" }));

    expect(screen.queryByText("7 matches")).toBeNull();
    expect(getRunButton().disabled).toBe(true);

    const stored =
      store.getState().searchPanelStates[
        getSearchPanelStateKey({ scope: "events", transcriptDir, transcriptId })
      ];
    expect(stored).toEqual(createInitialSearchPanelState());
  });
});
