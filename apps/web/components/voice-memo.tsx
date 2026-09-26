"use client";

import { useState, useCallback, useRef } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

type VoiceMemoProps = {
  workspaceId: string;
  onCaptured?: (text: string) => void;
  className?: string;
};

interface SpeechRecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }>;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

interface WindowWithSpeech {
  SpeechRecognition?: { new(): SpeechRecognitionInstance };
  webkitSpeechRecognition?: { new(): SpeechRecognitionInstance };
}

export function VoiceMemo({ workspaceId, onCaptured, className = "" }: VoiceMemoProps) {
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef<string>("");
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecording = useCallback(async () => {
    if (state !== "recording") return;
    setState("saving");

    // Stop speech recognition
    recognitionRef.current?.stop();

    // Stop media recorder and collect blob
    const audioBlob = await new Promise<Blob | null>((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = chunksRef.current.length > 0
          ? new Blob(chunksRef.current, { type: chunksRef.current[0].type })
          : null;
        resolve(blob);
      };
      recorder.stop();
    });

    // Stop mic stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const transcript = finalTranscriptRef.current.trim();

    // Upload audio blob to R2 if we have one
    let audioKey: string | undefined;
    if (audioBlob && audioBlob.size > 0) {
      try {
        const fd = new FormData();
        fd.append("audio", audioBlob, "recording.webm");
        fd.append("workspaceId", workspaceId);
        const res = await fetch("/api/voice", { method: "POST", body: fd });
        if (res.ok) {
          const data = (await res.json()) as { audioKey: string };
          audioKey = data.audioKey;
        }
      } catch {
        // best-effort
      }
    }

    // Only save if we have a transcript or audio
    if (!transcript && !audioKey) {
      setState("idle");
      return;
    }

    try {
      const content = transcript || "[Voice recording]";
      await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "voice", content, workspaceId, audioKey }),
      });
      setLast(transcript || "Voice recording saved");
      onCaptured?.(content);
    } catch {
      // ignore
    } finally {
      setState("idle");
    }
  }, [state, workspaceId, onCaptured]);

  const startRecording = useCallback(async () => {
    if (state !== "idle") return;

    chunksRef.current = [];
    finalTranscriptRef.current = "";
    setError(null);

    // Start mic stream for MediaRecorder
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access denied — enable it in your browser to record.");
      return;
    }
    streamRef.current = stream;

    // Start MediaRecorder
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : "audio/webm";

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(1000); // collect chunks every 1s

    // Start SpeechRecognition for transcript (Chrome/Edge only)
    const win = window as unknown as WindowWithSpeech;
    const SpeechRecognition = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        let final = "";
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript + " ";
          }
        }
        if (final) finalTranscriptRef.current = final;
      };
      recognition.onerror = () => {};
      recognition.onend = () => {};
      recognitionRef.current = recognition;
      recognition.start();
    }

    setState("recording");
  }, [state]);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        onClick={state === "idle" ? startRecording : stopRecording}
        disabled={state === "saving"}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
          state === "recording"
            ? "border-red-500 text-red-500 bg-red-50 dark:bg-red-950"
            : "border-border text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-50"
        }`}
        title={state === "idle" ? "Record voice memo" : "Stop recording"}
      >
        {state === "idle" && <Mic className="h-3.5 w-3.5" />}
        {state === "recording" && <MicOff className="h-3.5 w-3.5 animate-pulse" />}
        {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {state === "idle" && "Voice memo"}
        {state === "recording" && "Stop recording"}
        {state === "saving" && "Saving…"}
      </button>
      {last && (
        <span className="text-xs text-muted-foreground truncate max-w-xs" title={last}>
          ✓ &quot;{last.slice(0, 40)}{last.length > 40 ? "…" : ""}&quot;
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive truncate max-w-xs" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
