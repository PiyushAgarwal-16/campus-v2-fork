import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';

interface HealthResponse {
  status: string;
  service: string;
  database: string;
  timestamp: string;
}

/** Polls the API health endpoint — used by the Phase 00 connectivity smoke test. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
    refetchInterval: 15_000,
  });
}
