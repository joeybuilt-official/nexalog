"use client";

type Workspace = {
  id: string;
  name: string;
  color: string;
  kind: string;
};

type Props = {
  workspaces: Workspace[];
  activeWorkspaceId: string;
};

export function WorkspaceSwitcher({ workspaces, activeWorkspaceId }: Props) {
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  if (!active) return null;

  // Workspace switching / creation is not yet implemented server-side (every
  // user operates in a single ensurePersonalWorkspace). Render a static label
  // rather than a dropdown of dead controls.
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: active.color }} />
      <span className="truncate text-sm font-medium">{active.name}</span>
    </div>
  );
}
