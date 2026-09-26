'use client';
import { useEffect } from 'react';
import { drainOutbox } from './drain';

export function useOutboxDrain() {
  useEffect(() => {
    const drain = () => drainOutbox().catch(console.error);
    window.addEventListener('online', drain);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) drain(); });
    return () => window.removeEventListener('online', drain);
  }, []);
}
