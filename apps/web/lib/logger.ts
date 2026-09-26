export const logEvent = (event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
// ponytail: replace with OTel stdout exporter when Plexo exporter wired (Effect.withSpan on route chains)
