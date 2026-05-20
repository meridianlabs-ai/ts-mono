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

import {
  createInitialSearchPanelState,
  type GrepSearchPanelState,
  type LlmSearchPanelState,
  type SearchPanelState,
} from "@tsmono/inspect-components/transcript-search";
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
  SearchResponse,
} from "../../types/api-types";

import { getSearchPanelStateKey } from "./scoutSearchAdapters";
import { SearchPanel } from "./SearchPanel";

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
  startTranscriptId?: string;
};

const renderSearchPanel = ({
  scope = "events",
  initialState,
  projectModel = null,
  recentSearches = emptyRecentSearches,
  startTranscriptId = transcriptId,
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
        getSearchPanelStateKey({ scope, transcriptDir }),
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

  const route = `/transcripts/${encodeBase64Url(transcriptDir)}/${startTranscriptId}`;

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

  const searchPanel = (id: string) => (
    <SearchPanel
      scope={scope}
      transcriptDir={transcriptDir}
      transcriptId={id}
      onClose={() => {}}
    />
  );

  const utils = render(searchPanel(startTranscriptId), { wrapper: Wrapper });

  const rerenderSearchPanel = (id: string) => utils.rerender(searchPanel(id));

  return { ...utils, rerenderSearchPanel, store };
};

const recentGrepSearch = (
  overrides: Partial<SearchInputListResponse["items"][number]> = {}
): SearchInputListResponse["items"][number] => ({
  created_at: "2026-04-11T09:00:00Z",
  ignore_case: true,
  query: "needle",
  regex: false,
  search_id: "grep-1",
  type: "grep",
  word_boundary: false,
  ...overrides,
});

const selectRecentSearch = async (label: string) => {
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Recent searches" })
    ).not.toBeNull()
  );

  fireEvent.click(screen.getByRole("button", { name: "Recent searches" }));
  const option = await screen.findByRole("option", { name: label });
  fireEvent.mouseDown(option);
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
        return HttpResponse.json<SearchResponse>({
          id: "grep-1",
          result: seededGrepResult(3),
        });
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

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Run" })).not.toBeNull()
    );

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

  it("uses the submitted search id to load cached results after transcript changes", async () => {
    let postCalls = 0;
    const cachedRequests: Array<{
      transcriptId: string;
      searchId: string;
      events: string | null;
    }> = [];

    server.use(
      http.post("/api/v2/transcripts/:dir/:id/search", () => {
        postCalls += 1;
        return HttpResponse.json<SearchResponse>({
          id: "grep-compare",
          result: seededGrepResult(3),
        });
      }),
      http.get(
        "/api/v2/transcripts/:dir/:id/searches/:searchId",
        ({ request, params }) => {
          const url = new URL(request.url);
          cachedRequests.push({
            transcriptId: String(params.id),
            searchId: String(params.searchId),
            events: url.searchParams.get("events"),
          });
          return HttpResponse.json<Result>(seededGrepResult(9));
        }
      )
    );

    const { rerenderSearchPanel, store } = renderSearchPanel({
      initialState: buildState({
        searchType: "grep",
        searches: {
          grep: { query: "needle" },
        },
      }),
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Run" })).not.toBeNull()
    );

    fireEvent.click(getRunButton());

    await waitFor(() => {
      expect(screen.queryByText("3 matches")).not.toBeNull();
    });

    rerenderSearchPanel("next-transcript");

    await waitFor(() => {
      expect(screen.queryByText("9 matches")).not.toBeNull();
    });

    expect(postCalls).toBe(1);
    expect(cachedRequests).toEqual([
      {
        transcriptId: "next-transcript",
        searchId: "grep-compare",
        events: "all",
      },
    ]);

    const stored =
      store.getState().searchPanelStates[
        getSearchPanelStateKey({ scope: "events", transcriptDir })
      ];
    expect(stored?.searches.grep.query).toBe("needle");
    expect(stored?.searches.grep.searchId).toBe("grep-compare");
  });

  it("selects a recent search and loads cached results without posting", async () => {
    let postCalls = 0;
    const cachedRequests: Array<{
      transcriptId: string;
      searchId: string;
      events: string | null;
    }> = [];

    server.use(
      http.post("/api/v2/transcripts/:dir/:id/search", () => {
        postCalls += 1;
        return HttpResponse.json<SearchResponse>({
          id: "unexpected-post",
          result: seededGrepResult(1),
        });
      }),
      http.get(
        "/api/v2/transcripts/:dir/:id/searches/:searchId",
        ({ request, params }) => {
          const url = new URL(request.url);
          cachedRequests.push({
            transcriptId: String(params.id),
            searchId: String(params.searchId),
            events: url.searchParams.get("events"),
          });
          return HttpResponse.json<Result>(seededGrepResult(4));
        }
      )
    );

    renderSearchPanel({
      recentSearches: {
        items: [recentGrepSearch({ search_id: "grep-recent" })],
      },
    });

    await selectRecentSearch("needle");

    await waitFor(() => {
      expect(screen.queryByText("4 matches")).not.toBeNull();
    });

    expect(postCalls).toBe(0);
    expect(cachedRequests).toEqual([
      {
        transcriptId,
        searchId: "grep-recent",
        events: "all",
      },
    ]);
  });

  it("requires an explicit LLM model before submitting", async () => {
    useUserSettings.setState({
      dataframeColumnPresets: [],
      searchModelHistory: [],
    });

    renderSearchPanel({
      projectModel: "project-default-model",
      initialState: buildState({
        searchType: "llm",
        searches: {
          llm: { query: "What happened?", model: "" },
        },
      }),
    });

    const modelInput = await screen.findByPlaceholderText<HTMLInputElement>(
      "project-default-model"
    );

    expect(modelInput.required).toBe(true);
    expect(modelInput.checkValidity()).toBe(false);
    expect(getRunButton().disabled).toBe(false);
  });

  it("submits an LLM search with the explicit model and records it on success", async () => {
    useUserSettings.setState({
      dataframeColumnPresets: [],
      searchModelHistory: [],
    });

    let capturedBody: unknown;
    server.use(
      http.post("/api/v2/transcripts/:dir/:id/search", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json<SearchResponse>({
          id: "llm-1",
          result: { value: 1, references: [] },
        });
      })
    );

    renderSearchPanel({
      projectModel: "project-default-model",
      initialState: buildState({
        searchType: "llm",
        searches: {
          llm: { query: "What happened?", model: "openai/custom-model" },
        },
      }),
    });

    await waitFor(() =>
      expect(screen.queryByDisplayValue("openai/custom-model")).not.toBeNull()
    );

    fireEvent.click(getRunButton());

    await waitFor(() => {
      expect(capturedBody).toEqual({
        events: "all",
        model: "openai/custom-model",
        query: "What happened?",
        type: "llm",
      });
    });

    await waitFor(() => {
      expect(useUserSettings.getState().searchModelHistory).toEqual([
        "openai/custom-model",
      ]);
    });
  });

  it("keeps showing prior results while editing the query", async () => {
    server.use(
      http.get("/api/v2/transcripts/:dir/:id/searches/:searchId", () =>
        HttpResponse.json<Result>(seededGrepResult(5))
      )
    );

    renderSearchPanel({
      initialState: buildState({
        searchType: "grep",
        searches: {
          grep: { query: "needle", searchId: "grep-kept" },
        },
      }),
    });

    await waitFor(() => expect(screen.queryByText("5 matches")).not.toBeNull());

    const textarea = screen.getByTestId("search-textarea");
    fireEvent.input(textarea, { target: { value: "needles" } });

    expect(screen.queryByText("5 matches")).not.toBeNull();
  });

  it("preserves results when toggling search type and back", async () => {
    server.use(
      http.get("/api/v2/transcripts/:dir/:id/searches/:searchId", () =>
        HttpResponse.json<Result>(seededGrepResult(5))
      )
    );

    renderSearchPanel({
      initialState: buildState({
        searchType: "grep",
        searches: {
          grep: { query: "needle", searchId: "grep-kept" },
          llm: { query: "question" },
        },
      }),
    });

    await waitFor(() => expect(screen.queryByText("5 matches")).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "LLM" }));

    // The grep result should not be visible while we're on the LLM tab.
    expect(screen.queryByText("5 matches")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Grep" }));

    await waitFor(() => expect(screen.queryByText("5 matches")).not.toBeNull());
  });

  it("does not show 'No results found' before a selected search has been run", async () => {
    server.use(
      http.get("/api/v2/transcripts/:dir/:id/searches/:searchId", () =>
        // The cached endpoint returns null when the search hasn't been run
        // for this transcript yet.
        HttpResponse.json(null)
      )
    );

    renderSearchPanel({
      initialState: buildState({
        searchType: "grep",
        searches: { grep: { query: "needle", searchId: "grep-unrun" } },
      }),
    });

    // Wait for the loading state to clear.
    await waitFor(() => expect(screen.queryByText("Searching…")).toBeNull());

    expect(screen.queryByText("No results found")).toBeNull();
  });

  it("preserves separate query state across grep/llm toggle", async () => {
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
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "LLM" })).not.toBeNull()
    );

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

  it("resets state when New search is clicked", async () => {
    server.use(
      http.get("/api/v2/transcripts/:dir/:id/searches/:searchId", () =>
        HttpResponse.json<Result>(seededGrepResult(7))
      )
    );

    const { store } = renderSearchPanel({
      initialState: buildState({
        searchType: "grep",
        searches: {
          grep: { query: "stale", searchId: "grep-stale" },
          llm: { query: "lingering" },
        },
      }),
    });

    await waitFor(() => expect(screen.queryByText("7 matches")).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "New search" }));

    expect(screen.queryByText("7 matches")).toBeNull();
    expect(getRunButton().disabled).toBe(true);

    const stored =
      store.getState().searchPanelStates[
        getSearchPanelStateKey({ scope: "events", transcriptDir })
      ];
    expect(stored).toEqual(createInitialSearchPanelState());
  });
});
