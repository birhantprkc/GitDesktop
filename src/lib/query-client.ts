import { QueryClient } from "@tanstack/react-query";

// Module-level so non-React code (e.g. the automations runner) can
// invalidate queries after background work lands.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
