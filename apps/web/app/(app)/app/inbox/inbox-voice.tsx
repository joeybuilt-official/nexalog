"use client";

import { useRouter } from "next/navigation";
import { VoiceMemo } from "@/components/voice-memo";

export function InboxVoice({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();

  function handleCaptured() {
    router.refresh();
  }

  return (
    <VoiceMemo
      workspaceId={workspaceId}
      onCaptured={handleCaptured}
      className="mt-3"
    />
  );
}
