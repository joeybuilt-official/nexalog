// SPDX-License-Identifier: MIT
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, FileText, Bookmark, Zap, Search, type LucideIcon } from "lucide-react";
import { useModals } from "@/components/modal-context";

type LinkItem = { kind: "link"; href: string; label: string; icon: LucideIcon };
type ActionItem = { kind: "action"; id: "capture" | "search"; label: string; icon: LucideIcon };
type Item = LinkItem | ActionItem;

const ITEMS: Item[] = [
  { kind: "link", href: "/app/today", label: "Today", icon: Sun },
  { kind: "link", href: "/app/notes", label: "Notes", icon: FileText },
  { kind: "action", id: "capture", label: "Capture", icon: Zap },
  { kind: "link", href: "/app/bookmarks", label: "Bookmarks", icon: Bookmark },
  { kind: "action", id: "search", label: "Search", icon: Search },
];

const ITEM_CLS =
  "flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[56px] text-[10px] font-medium transition-colors";

export function MobileBottomNav() {
  const pathname = usePathname();
  const { openSearch, openCapture } = useModals();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {ITEMS.map((item) => {
        if (item.kind === "link") {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`${ITEM_CLS} ${active ? "text-copper" : "text-muted-foreground"}`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            onClick={item.id === "search" ? openSearch : openCapture}
            className={`${ITEM_CLS} text-muted-foreground`}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
