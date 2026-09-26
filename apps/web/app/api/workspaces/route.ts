/**
 * List the authenticated user's workspaces. Additive — the native client uses
 * this to populate its workspace switcher (web resolves workspaces server-side
 * in the app layout). Ensures a personal workspace exists, matching the layout.
 */
import { getAuthUser } from "@/lib/auth/server";
import { ensurePersonalWorkspace, getUserWorkspaces } from "@/lib/workspace";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  await ensurePersonalWorkspace(user.id);
  const workspaces = await getUserWorkspaces(user.id);

  return Response.json({ workspaces });
}
