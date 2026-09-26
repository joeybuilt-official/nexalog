import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/server";
import { ensurePersonalWorkspace, getUserWorkspaces } from "@/lib/workspace";
import { AppShell } from "@/components/app-shell";
import { TimezoneSync } from "@/components/timezone-sync";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspace = await ensurePersonalWorkspace(user.id);
  const workspaces = await getUserWorkspaces(user.id);

  return (
    <AppShell user={user} workspaces={workspaces} activeWorkspaceId={workspace.id}>
      <TimezoneSync />
      {children}
    </AppShell>
  );
}
