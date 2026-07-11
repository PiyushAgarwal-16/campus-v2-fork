'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WallPost, WallCategory, WallFeedMode } from '@campusly/shared-types';
import { WALL_SERVER_EVENTS } from '@campusly/shared-types';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { wallApi } from '../../lib/wall';
import { connectSocket, getSocket } from '../../lib/socket';
import { AppNav } from '../../components/AppNav';
import { Composer } from '../../components/wall/Composer';
import { PostCard } from '../../components/wall/PostCard';
import { Button } from '../../components/ui/Button';
import { Plus, Flame, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Campus Wall feed (PUBLIC_WALL.md §5): latest/trending toggle, category filter,
 * compose, infinite scroll via cursor, and realtime new-post fan-out.
 */
export default function WallPage() {
  const { user, isLoading } = useRequireAuth();
  const [mode, setMode] = useState<WallFeedMode>('latest');
  const [categoryId, setCategoryId] = useState<string>('');
  const [categories, setCategories] = useState<WallCategory[]>([]);
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showComposer, setShowComposer] = useState(false);

  useEffect(() => {
    void wallApi.categories().then(setCategories);
  }, []);

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const res = await wallApi.feed({
          mode,
          categoryId: categoryId || undefined,
          cursor: reset ? undefined : (cursor ?? undefined),
        });
        setPosts((prev) => (reset ? res.posts : [...prev, ...res.posts]));
        setCursor(res.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [mode, categoryId, cursor],
  );

  // Reload when mode/category changes.
  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, categoryId]);

  // Realtime: prepend new posts on this campus (latest mode only).
  useEffect(() => {
    const socket = connectSocket();
    const onNew = (payload: { post: WallPost }) => {
      if (mode !== 'latest' || categoryId) return;
      setPosts((prev) =>
        prev.some((p) => p.id === payload.post.id) ? prev : [payload.post, ...prev],
      );
    };
    const onDeleted = (payload: { postId: string }) => {
      setPosts((prev) => prev.filter((p) => p.id !== payload.postId));
    };
    socket.on(WALL_SERVER_EVENTS.NEW_POST, onNew);
    socket.on(WALL_SERVER_EVENTS.POST_DELETED, onDeleted);
    return () => {
      socket.off(WALL_SERVER_EVENTS.NEW_POST, onNew);
      socket.off(WALL_SERVER_EVENTS.POST_DELETED, onDeleted);
    };
  }, [mode, categoryId]);

  useEffect(() => {
    getSocket();
  }, []);

  if (isLoading || !user) return null;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <div className="shrink-0">
        <AppNav />
      </div>
      {/* Main Content Area: Fixed Header + Scrollable Feed */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Fixed Header & Filters Container */}
        <div className="w-full shrink-0 bg-background border-b border-divider z-10">
          <div className="mx-auto max-w-2xl md:max-w-4xl px-space-4 py-2 md:py-space-4 flex flex-col gap-2 md:gap-space-4">
            {/* Minimalist Top Header (Desktop only) */}
            <div className="hidden md:flex items-center justify-between gap-space-4 select-none shrink-0">
              <h1 className="text-h2 font-bold font-display text-foreground">Campus Wall</h1>
              <Button
                size="sm"
                onClick={() => setShowComposer(true)}
                className="rounded-full gap-1 shadow-md hover:shadow-lg active:scale-95 transition-all bg-brand text-brand-foreground font-semibold px-4"
              >
                <Plus className="h-4 w-4" />
                <span>New Post</span>
              </Button>
            </div>

            {/* Horizontal Scroll Mode & Category Filters */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1 select-none shrink-0 -mx-space-4 px-space-4 md:mx-0 md:px-0">
              {/* Mode Filters */}
              <button
                onClick={() => setMode('latest')}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-small font-medium transition-all shrink-0 border border-border/80',
                  mode === 'latest'
                    ? 'bg-brand text-brand-foreground border-brand font-semibold shadow-sm'
                    : 'bg-surface text-muted-foreground hover:text-foreground',
                )}
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Latest</span>
              </button>
              <button
                onClick={() => setMode('trending')}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-small font-medium transition-all shrink-0 border border-border/80',
                  mode === 'trending'
                    ? 'bg-brand text-brand-foreground border-brand font-semibold shadow-sm'
                    : 'bg-surface text-muted-foreground hover:text-foreground',
                )}
              >
                <Flame className="h-3.5 w-3.5" />
                <span>Trending</span>
              </button>

              <div className="h-4 w-px bg-divider shrink-0 mx-1" />

              {/* Category Filters */}
              <button
                onClick={() => setCategoryId('')}
                className={cn(
                  'rounded-full px-4 py-1.5 text-small font-medium transition-all shrink-0 border border-border/80',
                  categoryId === ''
                    ? 'bg-brand/10 border-brand/20 text-brand font-semibold'
                    : 'bg-surface text-muted-foreground hover:text-foreground',
                )}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(c.id)}
                  className={cn(
                    'rounded-full px-4 py-1.5 text-small font-medium transition-all shrink-0 border border-border/80',
                    categoryId === c.id
                      ? 'bg-brand/10 border-brand/20 text-brand font-semibold'
                      : 'bg-surface text-muted-foreground hover:text-foreground',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Scrollable Feed Container */}
        <div className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-2xl md:max-w-4xl px-0 md:px-space-4 py-space-5 pb-24 md:pb-8 flex flex-col gap-space-4">
            {posts.length === 0 && !loading && (
              <p className="py-space-12 text-center text-caption text-muted-foreground px-space-4">
                Nothing here yet. Be the first to post.
              </p>
            )}
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                selfId={user.id}
                onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
              />
            ))}

            {mode === 'latest' && cursor && (
              <div className="px-space-4 md:px-0 w-full">
                <Button
                  variant="secondary"
                  disabled={loading}
                  onClick={() => void load(false)}
                  className="w-full mt-space-2 rounded-full py-2.5 active:scale-95 transition-all shadow-sm"
                >
                  {loading ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Floating Action Button (FAB) */}
      <button
        type="button"
        onClick={() => setShowComposer(true)}
        className="md:hidden fixed bottom-24 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-xl hover:scale-105 active:scale-95 transition-all border border-brand/20 animate-in fade-in zoom-in duration-200"
        aria-label="New Post"
      >
        <Plus className="h-6 w-6 stroke-[2.5]" />
      </button>

      {/* Composer Modal Overlay */}
      {showComposer && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-space-4 animate-in fade-in duration-200">
          <div className="absolute inset-0" onClick={() => setShowComposer(false)} />
          <Composer
            categories={categories}
            onCreated={(post) => {
              setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]));
              setShowComposer(false);
            }}
            onClose={() => setShowComposer(false)}
          />
        </div>
      )}
    </div>
  );
}
