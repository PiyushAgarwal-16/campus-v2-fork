'use client';

import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import type { MessageContextType } from '@campusly/shared-types';
import { ImagePlus, Mic, Square, Paperclip, Shuffle } from 'lucide-react';
import { useConversation } from '../hooks/useConversation';
import { mediaApi } from '../lib/media';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { MediaAttachment } from './MediaAttachment';
import { cn } from '../lib/utils';

/**
 * Reusable conversation UI (UI_GUIDELINES.md §12): message list + composer.
 * Drives anonymous sessions and friend chats. Supports text plus media: image
 * attachments (file uploads are restricted to images) and recorded voice
 * messages. Bytes upload directly to storage, only references flow over the
 * socket (MEDIA_SYSTEM.md §3, §6).
 */
export function Chat({
  contextType,
  contextId,
  selfId,
  onNextMatch,
}: {
  contextType: MessageContextType;
  contextId: string;
  selfId: string;
  onNextMatch?: () => void;
}) {
  const { messages, partnerTyping, expiredMessageIds, send, sendMedia, notifyTyping } =
    useConversation(contextType, contextId);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, partnerTyping]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
    setDraft('');
  };

  const onPickImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMediaError(null);
    setBusy(true);
    try {
      const media = await mediaApi.upload(file, 'image', { isTemporary: true });
      sendMedia(media.id, 'image');
    } catch {
      setMediaError('Could not send that image. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    setMediaError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMediaError('Voice messages are not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Pick a format this browser can actually record (Safari uses mp4, not webm).
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const supported = candidates.find((t) => MediaRecorder.isTypeSupported?.(t));
      const recorder = supported
        ? new MediaRecorder(stream, { mimeType: supported })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const durationMs = Date.now() - startedAtRef.current;
        // Use the recorder's actual mime (minus codec params) so the stored
        // content-type matches the real bytes and plays back everywhere.
        const mime = (recorder.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(chunksRef.current, { type: mime });
        setBusy(true);
        mediaApi
          .upload(blob, 'voice', { durationMs })
          .then((media) => sendMedia(media.id, 'voice', durationMs))
          .catch(() => setMediaError('Could not send that voice message. Please try again.'))
          .finally(() => setBusy(false));
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setRecording(true);
    } catch {
      setMediaError('Microphone access was blocked. Allow it and try again.');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex-1 overflow-y-auto px-space-4 py-space-4 bg-chat-doodles">
        {messages.length === 0 ? (
          <p className="py-space-8 text-center text-caption text-muted-foreground">
            {contextType === 'friendship'
              ? 'Say hello to your new friend.'
              : "Say hello — you're chatting anonymously."}
          </p>
        ) : (
          <ul className="flex flex-col gap-space-2">
            {messages.map((m) => {
              const mine = m.senderId === selfId;
              const hasAttachment = m.attachment !== null && m.attachment !== undefined;
              return (
                <li key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  {hasAttachment ? (
                    <div className="max-w-[75%] rounded-card overflow-hidden">
                      <MediaAttachment
                        attachment={m.attachment!}
                        expired={expiredMessageIds.has(m.id)}
                      />
                    </div>
                  ) : (
                    <span
                      className={cn(
                        'max-w-[75%] rounded-card px-space-3 py-space-2 text-body break-words whitespace-pre-wrap',
                        mine
                          ? 'bg-brand text-brand-foreground'
                          : 'bg-surface text-foreground border border-border',
                      )}
                    >
                      {m.body}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {partnerTyping && (
          <div className="flex justify-start mt-space-2">
            <span className="bg-surface text-foreground border border-border rounded-card px-space-4 h-[38px] flex items-center justify-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full bg-muted-foreground/75 animate-typing-dot"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-muted-foreground/75 animate-typing-dot"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-muted-foreground/75 animate-typing-dot"
                style={{ animationDelay: '300ms' }}
              />
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {mediaError && (
        <p className="px-space-1 pt-space-2 text-caption text-danger" role="alert">
          {mediaError}
        </p>
      )}

      <form
        className="relative flex items-center gap-space-2 border-t border-divider px-space-4 md:px-space-6 pt-space-3 pb-[env(safe-area-inset-bottom,16px)] md:pb-0"
        onSubmit={onSubmit}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => void onPickImage(e)}
        />

        {/* Media popover options */}
        {showMediaMenu && !recording && (
          <div className="absolute bottom-[60px] left-4 bg-card border border-border rounded-2xl shadow-xl flex flex-col p-2 z-30 min-w-[155px] gap-1 animate-in slide-in-from-bottom-2 duration-150">
            <button
              type="button"
              onClick={() => {
                setShowMediaMenu(false);
                fileRef.current?.click();
              }}
              className="flex items-center gap-3 px-3 py-2 text-small font-medium hover:bg-muted/60 transition-colors rounded-xl text-foreground text-left w-full"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#8e6ef5] text-white shadow-sm shadow-[#8e6ef5]/20">
                <ImagePlus className="h-4 w-4 stroke-[2.2]" />
              </span>
              <span>Photo</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMediaMenu(false);
                void startRecording();
              }}
              className="flex items-center gap-3 px-3 py-2 text-small font-medium hover:bg-muted/60 transition-colors rounded-xl text-foreground text-left w-full"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#ff5d6c] text-white shadow-sm shadow-[#ff5d6c]/20">
                <Mic className="h-4 w-4 stroke-[2.2]" />
              </span>
              <span>Voice Note</span>
            </button>
          </div>
        )}

        {/* Media Button */}
        {recording ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            aria-label="Stop recording"
            onClick={stopRecording}
            className="rounded-full h-9 w-9 p-0 flex items-center justify-center shrink-0"
          >
            <Square className="h-4.5 w-4.5" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Toggle media menu"
            disabled={busy}
            onClick={() => setShowMediaMenu(!showMediaMenu)}
            className={cn(
              'rounded-full h-9 w-9 p-0 flex items-center justify-center shrink-0 transition-transform duration-200',
              showMediaMenu ? 'rotate-45' : '',
            )}
          >
            <Paperclip className="h-5 w-5" />
          </Button>
        )}

        {/* Next User Button (Shuffle) */}
        {onNextMatch && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Next User"
            disabled={busy || recording}
            onClick={onNextMatch}
            className="rounded-full h-9 w-9 p-0 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/40"
          >
            <Shuffle className="h-5 w-5" />
          </Button>
        )}

        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            notifyTyping();
          }}
          placeholder={recording ? 'Recording…' : 'Type a message…'}
          aria-label="Message"
          maxLength={4000}
          disabled={recording}
          className="border-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-muted/30"
        />
        <Button type="submit" disabled={!draft.trim() || busy}>
          Send
        </Button>
      </form>
    </div>
  );
}
