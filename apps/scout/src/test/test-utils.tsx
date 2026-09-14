import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type PropsWithChildren } from "react";

import { type ComponentIcons } from "@tsmono/react/components";

import { apiScoutServer } from "../api/api-scout-server";
import { ApplicationIcons } from "../icons";
import { ApiProvider, createStore, StoreProvider } from "../state/store";

/** Icon set for component tests that render `@tsmono/react` components. */
export const testComponentIcons: ComponentIcons = {
  arrowDown: ApplicationIcons.arrows.down,
  arrowUp: ApplicationIcons.arrows.up,
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

export function createTestWrapper(): React.ComponentType<PropsWithChildren> {
  return createTestWrapperWithStore().wrapper;
}

export function createTestWrapperWithStore(): {
  wrapper: React.ComponentType<PropsWithChildren>;
  store: ReturnType<typeof createStore>;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  const api = apiScoutServer();
  const store = createStore(api);

  const wrapper = function TestWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiProvider value={api}>
          <StoreProvider value={store}>{children}</StoreProvider>
        </ApiProvider>
      </QueryClientProvider>
    );
  };

  return { wrapper, store };
}
