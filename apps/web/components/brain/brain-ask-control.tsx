// SPDX-License-Identifier: MIT
"use client";

/**
 * The reader's "Ask about this page" control and the rail it opens.
 *
 * The control is NOT hidden when the deployment cannot answer: hiding it would
 * leave a reader unable to discover the feature exists at all. It opens the
 * rail, and the rail states — from the server — that no turn can be taken and
 * shows no composer. That is the difference between an honest unavailable state
 * and the shipped defect this replaces (a control that looked live and did
 * nothing).
 */

import { useState } from "react";
import { MessageSquare } from "lucide-react";

import { ChatSurface } from "@/components/brain/chat-surface";

export function BrainAskControl({ scope, scopeTitle }: { scope: string; scopeTitle: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:border-copper"
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        {open ? "Hide chat" : "Ask about this page"}
      </button>
      {open && (
        <ChatSurface
          scope={scope}
          scopeTitle={scopeTitle}
          variant="rail"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
