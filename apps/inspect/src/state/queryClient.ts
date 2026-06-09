import { QueryClient } from "@tanstack/react-query";

import { defaultRetry } from "@tsmono/react";

// defaultRetry must stay the global default — the app-config query depends on it.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: defaultRetry } },
});
