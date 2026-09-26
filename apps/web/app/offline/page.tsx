export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">You&apos;re offline</h1>
      <p className="text-muted-foreground">
        Check your connection &mdash; Nexalog will sync when you&apos;re back.
      </p>
    </main>
  );
}
