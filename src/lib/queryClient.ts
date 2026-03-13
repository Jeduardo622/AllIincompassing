import { QueryClient } from '@tanstack/react-query';

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        const errorWithStatus = error as { status?: number };
        if (errorWithStatus?.status && errorWithStatus.status >= 400 && errorWithStatus.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
      refetchOnReconnect: 'always',
      staleTime: 1 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      networkMode: 'online',
    },
    mutations: {
      networkMode: 'online',
    },
  },
});
