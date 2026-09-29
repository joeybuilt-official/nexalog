// SPDX-License-Identifier: MIT
"use client";

/**
 * Pulls the daily queue and turns each item into a short spoken summary.
 * One item at a time is synthesized via `/api/voice/synthesize` and played.
 * After playback, marks the item opened via `/api/captures/[id]/open`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface VoiceQueueItem {
  id: string;
  url: string | null;
  title: string;
  host: string | null;
  summary: string | null;
  ogDescription?: string | null;
}

export interface UseVoiceQueueState {
  items: VoiceQueueItem[];
  index: number;
  playing: boolean;
  loading: boolean;
  error: string | null;
  speed: number;
  current: VoiceQueueItem | null;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  next: () => void;
  setSpeed: (s: number) => void;
  stop: () => void;
}

export function useVoiceQueue(): UseVoiceQueueState {
  const [items, setItems] = useState<VoiceQueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeedRaw] = useState(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  function disposeAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      disposeAudio();
    };
  }, []);

  const fetchQueue = useCallback(async (): Promise<VoiceQueueItem[]> => {
    const res = await fetch("/api/queue?n=12", { cache: "no-store" });
    // The route answers a genuinely-empty queue with an empty `items` array; a
    // non-2xx is a real failure and must reach the caller as one (the panel
    // renders it in `q.error`) rather than as "Queue is empty", which is what a
    // swallowed status produced before `/api/queue` existed.
    if (!res.ok) throw new Error(`queue ${res.status}`);
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        url: string | null;
        title: string | null;
        host: string | null;
        summary: string | null;
      }>;
    };
    const list = (data.items ?? [])
      .filter((i) => i.url || i.title || i.summary)
      .map<VoiceQueueItem>((i) => ({
        id: i.id,
        url: i.url,
        title: i.title || i.host || i.url || "Untitled",
        host: i.host,
        summary: i.summary,
      }));
    return list;
  }, []);

  const synthesize = useCallback(
    async (text: string): Promise<Blob> => {
      const res = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error((detail as { error?: string }).error ?? `tts ${res.status}`);
      }
      return await res.blob();
    },
    []
  );

  const playItem = useCallback(
    async (item: VoiceQueueItem) => {
      const text = buildSpokenText(item);
      const blob = await synthesize(text);
      if (cancelledRef.current) return;

      disposeAudio();
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audio.playbackRate = speed;
      audioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("audio_error"));
        audio.play().catch(reject);
      });

      // Best-effort: mark as opened.
      fetch(`/api/captures/${item.id}/open`, { method: "POST" }).catch(() => {});
    },
    [speed, synthesize]
  );

  const playFrom = useCallback(
    async (startIndex: number, list: VoiceQueueItem[]) => {
      cancelledRef.current = false;
      for (let i = startIndex; i < list.length; i++) {
        if (cancelledRef.current) return;
        setIndex(i);
        try {
          await playItem(list[i]);
        } catch (err) {
          setError((err as Error).message);
          // skip failed item
        }
      }
      if (!cancelledRef.current) {
        setPlaying(false);
      }
    },
    [playItem]
  );

  const start = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchQueue();
      setItems(list);
      setIndex(0);
      if (list.length === 0) {
        setError("Queue is empty.");
        return;
      }
      setPlaying(true);
      void playFrom(0, list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fetchQueue, playFrom]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    } else if (items.length > 0) {
      setPlaying(true);
      void playFrom(index, items);
    }
  }, [index, items, playFrom]);

  const next = useCallback(() => {
    cancelledRef.current = true;
    disposeAudio();
    cancelledRef.current = false;
    const nextIndex = index + 1;
    if (nextIndex >= items.length) {
      setPlaying(false);
      return;
    }
    setPlaying(true);
    void playFrom(nextIndex, items);
  }, [index, items, playFrom]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    disposeAudio();
    setPlaying(false);
    setIndex(0);
  }, []);

  const setSpeed = useCallback((s: number) => {
    setSpeedRaw(s);
    if (audioRef.current) audioRef.current.playbackRate = s;
  }, []);

  return {
    items,
    index,
    playing,
    loading,
    error,
    speed,
    current: items[index] ?? null,
    start,
    pause,
    resume,
    next,
    setSpeed,
    stop,
  };
}

function buildSpokenText(item: VoiceQueueItem): string {
  const lines: string[] = [];
  lines.push(item.title);
  if (item.host) lines.push(`From ${item.host}.`);
  if (item.summary) {
    const cleaned = item.summary
      .split("\n")
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 4);
    lines.push(...cleaned);
  } else if (item.ogDescription) {
    lines.push(item.ogDescription);
  }
  return lines.join(". ").slice(0, 1800);
}
