// SPDX-License-Identifier: MIT
// PWA Web Share Target handler — receives shared content from the OS share sheet.
"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { captureOrQueue } from "@/lib/offline/captureOrQueue";

function ShareHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"saving" | "done" | "error">("saving");

  useEffect(() => {
    const title = searchParams.get("title") ?? "";
    const text = searchParams.get("text") ?? "";
    const url = searchParams.get("url") ?? "";

    const content = url || text || title;
    if (!content.trim()) {
      router.replace("/app/today");
      return;
    }

    const isUrl = /^https?:\/\/\S+/.test(content.trim()) || /^https?:\/\/\S+/.test(url.trim());
    const kind = isUrl ? "url" : "text";
    const payload = {
      kind,
      content: content.trim(),
      url: isUrl ? (url || content).trim() : undefined,
    };

    captureOrQueue(payload)
      .then(({ queued }) => {
        setStatus("done");
        if (queued) console.log('[outbox] queued for later');
        setTimeout(() => router.replace("/app/inbox"), 1500);
      })
      .catch(() => setStatus("error"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      {status === "saving" && (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Saving to Nexalog…</p>
        </>
      )}
      {status === "done" && (
        <>
          <CheckCircle2 className="h-10 w-10 text-green-500" />
          <p className="text-sm font-medium text-foreground">Saved!</p>
          <p className="text-xs text-muted-foreground">Redirecting to inbox…</p>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm font-medium text-foreground">Something went wrong</p>
          <button
            onClick={() => router.back()}
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            Go back
          </button>
        </>
      )}
    </div>
  );
}

export default function SharePage() {
  return (
    <Suspense>
      <ShareHandler />
    </Suspense>
  );
}
