'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { WallPost, WallReply } from '@campusly/shared-types';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { wallApi } from '../../../lib/wall';
import { AppNav } from '../../../components/AppNav';
import { PostCard } from '../../../components/wall/PostCard';
import { Avatar } from '../../../components/Avatar';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Textarea } from '../../../components/ui/Textarea';

/** Post detail with replies (PUBLIC_WALL.md §6). One level of threading. */
export default function PostDetailPage() {
  const { user, isLoading } = useRequireAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const postId = params.id;

  const [post, setPost] = useState<WallPost | null>(null);
  const [replies, setReplies] = useState<WallReply[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!postId) return;
    void wallApi
      .getPost(postId)
      .then((res) => {
        setPost(res.post);
        setReplies(res.replies);
      })
      .catch(() => setNotFound(true));
  }, [postId]);

  if (isLoading || !user) return null;

  const submitReply = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const reply = await wallApi.reply(postId, { body: draft.trim(), isAnonymous: true });
      setReplies((prev) => [...prev, reply]);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl md:max-w-4xl flex-col gap-space-5 px-space-4 py-space-8 md:px-space-8">
      <AppNav />
      <Button variant="ghost" size="sm" className="self-start" onClick={() => router.push('/wall')}>
        ← Back to wall
      </Button>

      {notFound && (
        <p className="text-body text-muted-foreground">This post is no longer available.</p>
      )}

      {post && (
        <PostCard
          post={post}
          selfId={user.id}
          showReplyLink={false}
          onDeleted={() => router.push('/wall')}
        />
      )}

      {post && (
        <Card className="flex flex-col gap-space-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a reply…"
            maxLength={2000}
          />
          <div className="flex items-center gap-space-3">
            <Button
              className="ml-auto"
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={() => void submitReply()}
            >
              Reply
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-space-3">
        {replies.map((r) => (
          <Card key={r.id} className="flex flex-col gap-space-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-2">
                <Avatar name={r.authorHandle} mediaId={null} size="sm" />
                <span className="text-small font-medium text-foreground">{r.authorHandle}</span>
              </div>
              <time className="text-small text-muted-foreground">
                {new Date(r.createdAt).toLocaleDateString()}
              </time>
            </div>
            <p className="whitespace-pre-wrap text-body text-foreground">{r.body}</p>
          </Card>
        ))}
      </div>
    </main>
  );
}
