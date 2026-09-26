'use client';
import { useEffect, useState } from 'react';

export function OnlineIndicator() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const dn = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', dn);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', dn);
    };
  }, []);
  if (online) return null;
  return (
    <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-600">
      Offline
    </span>
  );
}
