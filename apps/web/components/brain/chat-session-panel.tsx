// SPDX-License-Identifier: MIT
"use client";

/**
 * The /app/chat page's mount of the chat surface. Same component as the reader
 * rail, `scope: null` — a question about the whole brain rather than one page.
 *
 * It is a thin file on purpose: the surface, the transport and the readiness
 * probe all live in `chat-surface` / `use-chat-session`, so there is exactly one
 * place that can decide whether a composer is shown.
 */

import { ChatSurface } from "@/components/brain/chat-surface";

export function ChatSessionPanel() {
  return <ChatSurface scope={null} scopeTitle="your brain" variant="panel" />;
}
