import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type PropsWithChildren } from "react";

import { apiScoutServer } from "../api/api-scout-server";
import { ApiProvider, createStore, StoreProvider } from "../state/store";

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
