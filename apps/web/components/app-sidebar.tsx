"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Settings,
  LogOut,
  FileText,
  Inbox,
  Sun,
  GitFork,
  Search,
  Bookmark,
  X,
  Notebook,
  RotateCcw,
  Boxes,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth/client";
import { useRouter } from "next/navigation";
import type { User } from "@/lib/auth/types";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { useModals } from "@/components/modal-context";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { id: string; label: string; items: NavItem[] };

// Intent-based groups. Order matches the typical session: arrive (Today)
// -> produce (Library) -> browse the brain (Garden) -> tweak (Workspace).
// NOTE: v2 §1.7 deleted the queue/chat/ideas/projects/watch/reading/reference/
// import/web-history/objects/dashboard routes — keep this list in sync with the
// routes that actually exist under apps/web/app/(app)/app/.
const navGroups: NavGroup[] = [
  {
    id: "today",
    label: "Today",
    items: [
      { href: "/app/today", label: "Today", icon: Sun },
      { href: "/app/journal", label: "Journal", icon: Notebook },
      { href: "/app/inbox", label: "Inbox", icon: Inbox },
      { href: "/app/review", label: "Review", icon: RotateCcw },
    ],
  },
  {
    id: "library",
    label: "Library",
    items: [
      { href: "/app/notes", label: "Notes", icon: FileText },
      { href: "/app/bookmarks", label: "Bookmarks", icon: Bookmark },
      { href: "/app/search", label: "Search", icon: Search },
    ],
  },
  {
    id: "brain",
    label: "Brain",
    items: [{ href: "/app/graph", label: "Garden", icon: GitFork }],
  },
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Routes v2 §1.7 deleted are NOT linked from the sidebar. This array only
// documents the historical set and keeps stale imports type-checked.
void ([
  { href: "/app/history", label: "History", icon: Boxes },
] satisfies NavItem[]);

type Workspace = { id: string; name: string; color: string; kind: string };

export function AppSidebar({ user, workspaces, activeWorkspaceId, onClose }: {
  user: User;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { openSearch } = useModals();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  function handleSearchClick() {
    openSearch();
    onClose?.();
  }

  return (
    <aside className="flex w-56 flex-col border-r border-border bg-background h-full">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <Link href="/app/dashboard" className="font-heading text-sm font-semibold" onClick={onClose}>
          <span className="text-copper">_</span>nexalog
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-2 pt-2">
        <WorkspaceSwitcher workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} />
      </div>

      <div className="px-2 py-1">
        <button
          onClick={handleSearchClick}
          className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-sm text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="text-[10px] font-mono bg-muted rounded px-1 hidden sm:inline">⌘K</kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        {navGroups.map((group, gi) => (
          <div key={group.id} className={gi > 0 ? "mt-3" : ""}>
            <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/app/dashboard" && pathname.startsWith(item.href + "/"));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2 rounded px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-card text-foreground"
                        : "text-muted-foreground hover:bg-card hover:text-foreground"
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-3 py-3 space-y-2">
        <ThemeToggle />
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground min-w-0">
            {user.email}
          </span>
          <button
            onClick={handleSignOut}
            className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
