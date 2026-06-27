'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MessageContextType } from '@campusly/shared-types';
import { useConversation } from '../hooks/useConversation';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { cn } from '../lib/utils';

/**
 * Reusable conversation UI (UI_GUIDELINES.md §12): message list + composer.
 * Drives both anonymous sessions and (Phase 05) friend chats. Sender messages
 * align right; the partner's align left.
 */
export function Chat({
  contextType,
  contextId,
  selfId,
}: {
  contextType: MessageContextType;
  contextId: string;
  selfId: string;
}) {
  const { messages, partnerTyping, send, notifyTyping } = useConversation(contextType, contextId);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, partnerTyping]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
    setDraft('');
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex-1 overflow-y-auto px-space-1 py-space-2">
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
              return (
                <li key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <span
                    className={cn(
                      'max-w-[75%] rounded-card px-space-3 py-space-2 text-body',
                      mine
                        ? 'bg-brand text-brand-foreground'
                        : 'bg-surface text-foreground border border-border',
                    )}
                  >
                    {m.body}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {partnerTyping && <p className="mt-space-2 text-caption text-muted-foreground">typing…</p>}
        <div ref={endRef} />
      </div>

      <form className="flex gap-space-2 border-t border-border pt-space-3" onSubmit={onSubmit}>
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            notifyTyping();
          }}
          placeholder="Type a message…"
          aria-label="Message"
          maxLength={4000}
        />
        <Button type="submit" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
