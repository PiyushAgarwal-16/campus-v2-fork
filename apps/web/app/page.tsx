'use client';

import { useHealth } from '../hooks/useHealth';
import { Button } from '../components/ui/Button';
import { Card, CardTitle, CardDescription } from '../components/ui/Card';
import { ThemeToggle } from '../components/ThemeToggle';

/**
 * Phase 00 app shell + connectivity smoke test. No product features — this page
 * proves the frontend boots, the theme system works, the design tokens render,
 * and the API client reaches the backend health endpoint.
 */
export default function HomePage() {
  const health = useHealth();

  const dbStatus = health.data?.database;
  const statusLabel = health.isLoading
    ? 'Checking…'
    : health.isError
      ? 'Unreachable'
      : `API ${health.data?.status} · DB ${dbStatus}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-space-8 px-space-4 py-space-12 md:px-space-8">
      <header className="flex items-center justify-between">
        <span className="text-h2 font-semibold text-brand">Campusly</span>
        <ThemeToggle />
      </header>

      <div className="flex flex-col gap-space-3">
        <h1 className="text-h1 text-foreground">Foundation ready.</h1>
        <p className="text-body text-muted-foreground">
          Phase 00 skeleton — Next.js, Tailwind design tokens, theme system, React Query, and the
          API client are wired. Product features begin in Phase 01.
        </p>
      </div>

      <Card className="flex flex-col gap-space-4">
        <div className="flex flex-col gap-space-1">
          <CardTitle>Backend connectivity</CardTitle>
          <CardDescription>Live status from GET /api/v1/health</CardDescription>
        </div>
        <div className="flex items-center gap-space-3">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              health.isError ? 'bg-danger' : dbStatus === 'connected' ? 'bg-success' : 'bg-warning'
            }`}
          />
          <span className="text-body text-foreground">{statusLabel}</span>
        </div>
        <div className="flex gap-space-3">
          <Button onClick={() => void health.refetch()}>Re-check</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
      </Card>
    </main>
  );
}
