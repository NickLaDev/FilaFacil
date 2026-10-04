import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/** Erros 4xx são definitivos (sem novas tentativas); falhas de rede/5xx tentam de novo. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
    },
    mutations: { retry: false },
  },
});
