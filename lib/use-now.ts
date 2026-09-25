'use client';

import { useEffect, useState } from 'react';

/**
 * The current time, refreshed on an interval. SLA screens count down, so a tab left open would otherwise keep saying
 * "due in 55 minutes" an hour later. Reading the clock in state rather than during render also keeps the render pure.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
