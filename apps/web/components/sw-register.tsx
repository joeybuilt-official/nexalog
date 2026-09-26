'use client';
import { useEffect } from 'react';
import { useOutboxDrain } from '@/lib/offline/useOutboxDrain';

export function SwRegister() {
  useOutboxDrain();

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
