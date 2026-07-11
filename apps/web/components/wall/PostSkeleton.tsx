/**
 * Loading placeholder for a wall post (Instagram/Facebook-style shimmer). Shown
 * while the feed is fetching so the layout is stable and the wait feels fast.
 */
export function PostSkeleton() {
  return (
    <article className="animate-pulse bg-background">
      {/* Header */}
      <div className="flex items-center gap-space-3 px-space-4 py-space-4">
        <div className="h-10 w-10 shrink-0 rounded-full bg-muted" />
        <div className="flex flex-col gap-space-2">
          <div className="h-3 w-32 rounded bg-muted" />
          <div className="h-2.5 w-20 rounded bg-muted" />
        </div>
      </div>
      {/* Body lines */}
      <div className="flex flex-col gap-space-2 px-space-4 pb-space-3">
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-4/5 rounded bg-muted" />
      </div>
      {/* Media band */}
      <div className="h-64 w-full bg-muted" />
      {/* Actions */}
      <div className="flex items-center gap-space-5 px-space-4 py-space-3">
        <div className="h-6 w-6 rounded-full bg-muted" />
        <div className="h-6 w-6 rounded-full bg-muted" />
        <div className="ml-auto h-6 w-6 rounded-full bg-muted" />
      </div>
      <div className="px-space-4 pb-space-4">
        <div className="h-3 w-16 rounded bg-muted" />
      </div>
    </article>
  );
}

export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-space-2">
      {Array.from({ length: count }, (_, i) => (
        <PostSkeleton key={i} />
      ))}
    </div>
  );
}
