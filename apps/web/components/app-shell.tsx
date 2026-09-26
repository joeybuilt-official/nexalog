"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { SearchModal } from "@/components/search-modal";
import { QuickCaptureModal } from "@/components/quick-capture-modal";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { ModalProvider } from "@/components/modal-context";
import { PeekProvider } from "@/components/peek-context";
import { PeekSheet } from "@/components/peek-sheet";
import type { User } from "@/lib/auth/types";
import { OnlineIndicator } from "@/components/online-indicator";

type Workspace = { id: string; name: string; color: string; kind: string };

type Props = {
  user: User;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  children: React.ReactNode;
};

export function AppShell({ user, workspaces, activeWorkspaceId, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <PeekProvider>
      <ModalProvider>
        <div className="flex min-h-dvh overflow-x-hidden md:h-dvh md:overflow-hidden">
          {/* Desktop sidebar */}
          <div className="hidden md:flex">
            <AppSidebar user={user} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} />
          </div>

          {/* Mobile overlay */}
          {open && (
            <>
              <div
                className="fixed inset-0 z-40 bg-black/50 md:hidden"
                onClick={() => setOpen(false)}
              />
              <div className="fixed inset-y-0 left-0 z-50 md:hidden">
                <AppSidebar user={user} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onClose={() => setOpen(false)} />
              </div>
            </>
          )}

          <div className="flex flex-1 flex-col min-w-0">
            {/* Mobile header */}
            <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
              <button
                onClick={() => setOpen(true)}
                className="rounded p-2 -ml-2 text-muted-foreground hover:text-foreground"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              <Link href="/app/dashboard" className="font-heading text-sm font-semibold">
                <span className="text-copper">_</span>nexalog
              </Link>
              <OnlineIndicator />
            </header>
            {/* pb-20 on mobile keeps content clear of the fixed bottom nav. */}
            <main className="flex flex-1 flex-col min-w-0 overflow-x-hidden p-4 pb-20 md:p-6 md:pb-6 md:min-h-0 md:overflow-y-auto">
              {children}
            </main>
          </div>

          <MobileBottomNav />
          <SearchModal />
          <QuickCaptureModal />
          <PeekSheet />
        </div>
      </ModalProvider>
    </PeekProvider>
  );
}
