export async function GET() {
  return Response.json({
    ok: true,
    appId: "nexalog",
    plexoConnected: !!process.env.PLEXO_URL,
    plexoUrl: process.env.PLEXO_URL ?? null,
    timestamp: new Date().toISOString(),
  });
}
