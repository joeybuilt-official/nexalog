import Link from "next/link";
import {
  Globe,
  Sparkles,
  Share2,
  Link2,
  CalendarDays,
  MessageSquare,
  Terminal,
  ArrowRight,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const features = [
  {
    icon: Globe,
    title: "Universal capture",
    desc: "Grab anything. Web clips, voice memos, screenshots, API payloads. One inbox, zero friction.",
  },
  {
    icon: Sparkles,
    title: "AI synthesis",
    desc: "Automatic summaries, tag suggestions, and connections surfaced from your raw captures.",
  },
  {
    icon: Share2,
    title: "Knowledge graph",
    desc: "Every note links to every other. Navigate your thinking as a living network, not a filing cabinet.",
  },
  {
    icon: Link2,
    title: "Wikilinks",
    desc: "[[Double-bracket]] any phrase to create or find a note. Backlinks are automatic.",
  },
  {
    icon: CalendarDays,
    title: "Daily notes",
    desc: "A fresh page every day. Journal, standup log, or scratchpad — your call.",
  },
  {
    icon: MessageSquare,
    title: "Conversation imports",
    desc: "Pull in chat threads from Slack, Discord, or email. Context lives with your notes.",
  },
];

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-heading font-semibold tracking-tight ${className ?? ""}`}>
      <span className="text-copper">_</span>nexalog
    </span>
  );
}

export default function MarketingPage() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      {/* Nav */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <Link href="/">
          <Wordmark className="text-lg" />
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-3xl px-6 pt-24 pb-20">
        <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Your digital brain.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          Capture everything. Let AI synthesize it. Watch connections emerge.
          Nexalog turns raw information into a knowledge graph you can actually
          think with.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/login"
            className="rounded bg-copper px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-copper-dim"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/joeybuilt-official/nexalog"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View Source <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      {/* Install */}
      <section className="mx-auto w-full max-w-3xl px-6 pb-16">
        <div className="rounded border border-border bg-card px-5 py-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Self-host in 60 seconds
          </p>
          <code className="font-mono text-sm text-foreground">
            git clone https://github.com/joeybuilt-official/nexalog.git && cd
            nexalog && docker compose up -d
          </code>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <h2 className="font-heading text-2xl font-semibold text-foreground">
          Everything connects.
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded border border-border bg-card p-5">
              <f.icon className="mb-3 h-5 w-5 text-copper" />
              <h3 className="font-heading text-sm font-semibold text-foreground">
                {f.title}
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CLI teaser */}
      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <div className="flex items-start gap-4 rounded border border-border bg-card p-5">
          <Terminal className="mt-0.5 h-5 w-5 shrink-0 text-copper" />
          <div>
            <h3 className="font-heading text-sm font-semibold text-foreground">
              CLI-first capture
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Pipe anything into Nexalog from your terminal.
            </p>
            <code className="mt-3 block font-mono text-sm text-muted-foreground">
              <span className="text-copper">$</span> echo &quot;meeting notes:
              discussed Q3 roadmap&quot; | nexalog capture
            </code>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border px-6 py-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Wordmark className="text-sm" />
          <span className="text-xs text-muted-foreground">
            Built by{" "}
            <a
              href="https://joeybuilt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:text-copper transition-colors"
            >
              Joeybuilt
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
