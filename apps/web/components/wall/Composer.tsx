'use client';

import { useState, type ChangeEvent } from 'react';
import type { WallCategory, WallPost, CreatePostInput } from '@campusly/shared-types';
import { ImagePlus, BarChart3, X, Loader2 } from 'lucide-react';
import { wallApi } from '../../lib/wall';
import { mediaApi } from '../../lib/media';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { cn } from '../../lib/utils';

export function Composer({
  categories,
  onCreated,
  onClose,
}: {
  categories: WallCategory[];
  onCreated: (post: WallPost) => void;
  onClose?: () => void;
}) {
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [poll, setPoll] = useState(false);
  const [options, setOptions] = useState<string[]>(['', '']);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setBusy(true);
    setError(null);
    try {
      const media = await mediaApi.upload(file, 'image', { isTemporary: false });
      setMediaId(media.id);
    } catch {
      setError('Could not attach that image.');
      setPreviewUrl(null);
    } finally {
      setBusy(false);
    }
  };

  const removeMedia = async () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (!mediaId) return;
    try {
      await mediaApi.remove(mediaId);
    } catch {
      // ignore
    }
    setMediaId(null);
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const input: CreatePostInput = {
        postType: poll ? 'poll' : 'text',
        body: body.trim() || undefined,
        // Everything posts anonymously now; the server enforces this regardless.
        isAnonymous: true,
        categoryId: categoryId || undefined,
        mediaIds: mediaId ? [mediaId] : undefined,
        pollOptions: poll ? options.map((o) => o.trim()).filter(Boolean) : undefined,
      };
      const post = await wallApi.createPost(input);
      onCreated(post);
      setBody('');
      setCategoryId('');
      setPoll(false);
      setOptions(['', '']);
      setMediaId(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    (poll
      ? options.filter((o) => o.trim()).length >= 2
      : body.trim().length > 0 || Boolean(mediaId));

  return (
    <div
      className={cn(
        'relative bg-card border border-border w-full rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex',
        previewUrl
          ? 'max-w-4xl flex-col md:flex-row md:h-[600px] h-[85vh]'
          : 'max-w-lg flex-col p-space-6 max-h-[85vh]',
      )}
    >
      {/* LEFT COLUMN: Media Preview (only if media is attached) */}
      {previewUrl && (
        <div className="relative w-full h-[40vh] md:h-full md:w-[60%] bg-black/95 flex flex-col items-center justify-center overflow-hidden shrink-0 group">
          {/* Blurred Background */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Preview bg"
            className="absolute inset-0 w-full h-full object-cover opacity-30 blur-3xl scale-110 pointer-events-none"
          />

          {/* Main Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Preview"
            className="relative z-10 w-full h-full object-contain pointer-events-none"
          />

          {/* Loading Overlay */}
          {busy && !mediaId && (
            <div className="absolute inset-0 z-30 bg-black/50 flex flex-col items-center justify-center backdrop-blur-sm">
              <Loader2 className="h-8 w-8 text-white animate-spin mb-space-2" />
              <span className="text-white text-small font-medium">Uploading...</span>
            </div>
          )}

          {/* Remove Button */}
          <button
            type="button"
            onClick={() => void removeMedia()}
            disabled={busy && !mediaId}
            className="absolute top-4 left-4 z-20 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 backdrop-blur-sm transition-all md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 disabled:opacity-0"
            aria-label="Remove image"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* RIGHT COLUMN (or Main Modal if no media): Editor & Settings */}
      <div
        className={cn(
          'flex flex-col flex-1 overflow-y-auto',
          previewUrl ? 'p-space-5 bg-card border-l border-divider' : '',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider pb-space-3 mb-space-4 sticky top-0 bg-card z-10">
          <h3 className="text-body font-bold text-foreground">
            {previewUrl ? 'New Post' : 'Create a Post'}
          </h3>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors rounded-full"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={previewUrl ? 'Write a caption...' : 'Share something with your campus…'}
          maxLength={5000}
          className={cn(
            'border-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent resize-none flex-1 p-0',
            previewUrl
              ? 'text-body min-h-[80px]'
              : 'text-h3 font-medium placeholder:text-muted-foreground/60 min-h-[120px]',
          )}
        />

        {poll && (
          <div className="flex flex-col gap-space-2 mt-space-4">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-space-2">
                <Input
                  value={opt}
                  onChange={(e) =>
                    setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))
                  }
                  placeholder={`Option ${i + 1}`}
                  maxLength={120}
                  className="bg-surface/50"
                />
                {options.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove option"
                    onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOptions((prev) => [...prev, ''])}
                className="w-max mt-1"
              >
                Add option
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-small text-danger mt-space-3">{error}</p>}

        {/* Settings accordion/list */}
        <div className="mt-auto flex flex-col gap-space-4 pt-space-4 border-t border-divider sticky bottom-0 bg-card z-10">
          <div className="flex flex-col gap-space-3">
            {/* Category Select */}
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-10 w-full rounded-input border border-border bg-surface/50 px-space-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap items-center justify-between gap-space-2">
              <div className="flex flex-wrap items-center gap-space-2">
                <Button
                  type="button"
                  variant={poll ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setPoll((v) => !v)}
                  className="h-10 px-space-3"
                >
                  <BarChart3 className="h-4 w-4" />
                  <span className="ml-space-1.5 hidden sm:inline">Poll</span>
                </Button>

                {!poll && !previewUrl && (
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => void onImage(e)}
                    />
                    <span className="inline-flex h-10 items-center gap-space-2 rounded-button px-space-3 text-small font-medium text-foreground bg-surface/50 hover:bg-muted transition-colors border border-border">
                      <ImagePlus className="h-4 w-4" />
                      <span className="hidden sm:inline">Image</span>
                    </span>
                  </label>
                )}
              </div>

              <Button
                size="sm"
                className="h-10 px-space-6 text-body font-bold rounded-full shadow-md mt-2 md:mt-0"
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                Share
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
