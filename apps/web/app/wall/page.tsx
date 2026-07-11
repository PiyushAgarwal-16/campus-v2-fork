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
import { AnnouncementBanner } from '../../components/wall/AnnouncementBanner';
import { FeedSkeleton } from '../../components/wall/PostSkeleton';
import { Button } from '../../components/ui/Button';
import { Plus, SlidersHorizontal, ChevronDown, Check } from 'lucide-react';
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
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!showFilters) return;
    const handleOutsideClick = () => setShowFilters(false);
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [showFilters]);

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
          <div className="mx-auto max-w-xl px-space-4 py-2 md:py-space-4 flex flex-col gap-2 md:gap-space-4">
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

            {/* Filters Dropdown */}
            <div className="relative inline-block text-left select-none py-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFilters(!showFilters);
                }}
                className={cn(
                  'flex items-center gap-2 rounded-full border border-border/80 px-4 py-2 text-small font-medium bg-surface text-foreground shadow-sm hover:bg-muted/50 active:scale-95 transition-all',
                  showFilters && 'border-brand ring-2 ring-brand/10',
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Filters</span>
                <span className="text-muted-foreground font-normal">•</span>
                <span className="text-brand font-semibold">
                  {mode === 'latest' ? 'Latest' : 'Trending'}
                </span>
                <span className="text-muted-foreground font-normal">•</span>
                <span className="text-brand font-semibold">
                  {categories.find((c) => c.id === categoryId)?.name ?? 'All'}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                    showFilters && 'rotate-180',
                  )}
                />
              </button>

              {/* Dropdown Menu Overlay */}
              {showFilters && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute left-0 mt-2 w-64 bg-surface border border-border rounded-xl shadow-xl z-50 p-space-4 flex flex-col gap-space-4 animate-in fade-in slide-in-from-top-2 duration-200"
                >
                  {/* Sort Mode Section */}
                  <div className="flex flex-col gap-space-2">
                    <span className="text-caption font-semibold text-muted-foreground tracking-wider uppercase text-[10px]">
                      Sort By
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setMode('latest');
                          setShowFilters(false);
                        }}
                        className={cn(
                          'rounded-button border px-3 py-1.5 text-small font-medium transition-all text-center',
                          mode === 'latest'
                            ? 'bg-brand text-brand-foreground border-brand font-semibold shadow-sm'
                            : 'bg-background hover:bg-muted/50 border-border text-foreground',
                        )}
                      >
                        Latest
                      </button>
                      <button
                        onClick={() => {
                          setMode('trending');
                          setShowFilters(false);
                        }}
                        className={cn(
                          'rounded-button border px-3 py-1.5 text-small font-medium transition-all text-center',
                          mode === 'trending'
                            ? 'bg-brand text-brand-foreground border-brand font-semibold shadow-sm'
                            : 'bg-background hover:bg-muted/50 border-border text-foreground',
                        )}
                      >
                        Trending
                      </button>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="h-px bg-divider" />

                  {/* Category Selection Section */}
                  <div className="flex flex-col gap-space-2">
                    <span className="text-caption font-semibold text-muted-foreground tracking-wider uppercase text-[10px]">
                      Categories
                    </span>
                    <div className="max-h-48 overflow-y-auto flex flex-col gap-1 pr-1 scrollbar-thin">
                      {/* All option */}
                      <button
                        onClick={() => {
                          setCategoryId('');
                          setShowFilters(false);
                        }}
                        className={cn(
                          'flex items-center justify-between rounded-button px-3 py-1.5 text-small font-medium text-left transition-all',
                          categoryId === ''
                            ? 'bg-brand/10 text-brand font-semibold'
                            : 'hover:bg-muted/50 text-foreground',
                        )}
                      >
                        <span>All Categories</span>
                        {categoryId === '' && <Check className="h-3.5 w-3.5 text-brand" />}
                      </button>

                      {categories.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setCategoryId(c.id);
                            setShowFilters(false);
                          }}
                          className={cn(
                            'flex items-center justify-between rounded-button px-3 py-1.5 text-small font-medium text-left transition-all',
                            categoryId === c.id
                              ? 'bg-brand/10 text-brand font-semibold'
                              : 'hover:bg-muted/50 text-foreground',
                          )}
                        >
                          <span>{c.name}</span>
                          {categoryId === c.id && <Check className="h-3.5 w-3.5 text-brand" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Feed — full-width posts with a fixed gap between them */}
        <div className="flex-1 overflow-y-auto bg-muted/30 pb-24 md:pb-8">
          <div className="mx-auto flex max-w-xl flex-col gap-space-2 py-space-2">
            {/* Admin announcements (dismissible, live via socket) */}
            <AnnouncementBanner />

            {/* First-load skeleton (Instagram/Facebook-style shimmer) */}
            {loading && posts.length === 0 && <FeedSkeleton count={4} />}

            {!loading && posts.length === 0 && (
              <div className="bg-background px-space-4 py-space-16 text-center">
                <p className="text-body font-medium text-foreground">Nothing here yet</p>
                <p className="mt-space-1 text-caption text-muted-foreground">
                  Be the first to post on your campus wall.
                </p>
              </div>
            )}

            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                selfId={user.id}
                onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
              />
            ))}

            {/* Loading more (skeleton tail) */}
            {loading && posts.length > 0 && <FeedSkeleton count={2} />}

            {mode === 'latest' && cursor && !loading && (
              <div className="bg-background p-space-4">
                <Button
                  variant="secondary"
                  onClick={() => void load(false)}
                  className="w-full rounded-full py-2.5 transition-all active:scale-95"
                >
                  Load more
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
