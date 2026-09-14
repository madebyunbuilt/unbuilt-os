'use client';

import { useMutation } from 'convex/react';
import { useEffect, useRef } from 'react';
import { api } from '@/convex/_generated/api';

// Tells the server the person is using the team app, so an untouched open tab still signs out after 12 idle hours
// (03-auth-and-permissions.md). Opening a page counts, then clicks, typing, scrolling and touches, at most every few
// minutes.

export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function ActivityHeartbeat() {
  const record = useMutation(api.sessionActivity.record);
  const lastSent = useRef(0);

  useEffect(() => {
    const send = () => {
      const now = Date.now();
      if (now - lastSent.current < HEARTBEAT_INTERVAL_MS) return;
      lastSent.current = now;
      // An idle or ended session refuses this; the page's own queries show the session-ended screen.
      record({}).catch(() => {});
    };
    send();
    for (const event of EVENTS) window.addEventListener(event, send, { passive: true, capture: true });
    return () => {
      for (const event of EVENTS) window.removeEventListener(event, send, { capture: true });
    };
  }, [record]);

  return null;
}
