'use client';

import { useCallback, useEffect, useState } from 'react';
import { ADMIN_SERVER_EVENTS, type Announcement } from '@campusly/shared-types';
import { connectSocket, getSocket } from '../lib/socket';
import { announcementsApi } from '../lib/announcements';

const DISMISSED_KEY = 'campusly.dismissedAnnouncements';

/** Reads the set of dismissed announcement ids from localStorage. */
function readDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * Drives the Wall announcement banner (ADMIN_PANEL.md §9). Loads the active
 * announcements for the caller's campus over REST, keeps them fresh via the
 * `announcement_broadcast` socket event, and remembers per-device dismissals in
 * localStorage so a dismissed announcement never reappears.
 */
export function useAnnouncements() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  useEffect(() => {
    void announcementsApi
      .active()
      .then(setItems)
      .catch(() => {});

    const socket = connectSocket();
    const onBroadcast = (payload: { announcement: Announcement }) => {
      setItems((prev) =>
        prev.some((a) => a.id === payload.announcement.id) ? prev : [payload.announcement, ...prev],
      );
    };
    socket.on(ADMIN_SERVER_EVENTS.ANNOUNCEMENT_BROADCAST, onBroadcast);
    return () => {
      socket.off(ADMIN_SERVER_EVENTS.ANNOUNCEMENT_BROADCAST, onBroadcast);
    };
  }, []);

  useEffect(() => {
    getSocket();
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      }
      return next;
    });
  }, []);

  const visible = items.filter((a) => !dismissed.has(a.id));
  return { announcements: visible, dismiss };
}
