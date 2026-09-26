// SPDX-License-Identifier: MIT
"use client";

import { useState } from "react";
import Link from "next/link";
import { updateUser, changePassword } from "@/lib/auth/client";

interface Workspace {
  id: string;
  name: string;
  color: string;
  kind: string;
}

interface Props {
  user: { id: string; email: string; name: string };
  workspaces: Workspace[];
  billingPlan: string;
  billingStatus: string | null;
  billingEnabled: boolean;
  savePageVisits: boolean;
  historyDenylist: string[];
  historyRetentionDays: number;
}

export default function SettingsView({ user, workspaces, billingPlan, billingStatus, billingEnabled, savePageVisits, historyDenylist, historyRetentionDays }: Props) {
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [histOn, setHistOn] = useState(savePageVisits);
  const [denylist, setDenylist] = useState(historyDenylist.join("\n"));
  const [retention, setRetention] = useState(String(historyRetentionDays));
  const [histSaving, setHistSaving] = useState(false);
  const [histSaved, setHistSaved] = useState(false);

  async function saveHistory(next?: Partial<{ savePageVisits: boolean }>) {
    setHistSaving(true);
    setHistSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savePageVisits: next?.savePageVisits ?? histOn,
          historyDenylist: denylist.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          historyRetentionDays: Number(retention) || 90,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setHistOn(data.savePageVisits);
        setHistSaved(true);
        setTimeout(() => setHistSaved(false), 3000);
      }
    } finally {
      setHistSaving(false);
    }
  }

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordOk, setPasswordOk] = useState(false);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setProfileError(null);
    setSaved(false);
    try {
      const result = await updateUser({ name });
      if (result.error) {
        setProfileError(result.error.message ?? "Failed to save");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      setProfileError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordSaving(true);
    setPasswordMsg(null);
    setPasswordOk(false);
    try {
      const result = await changePassword(currentPassword, newPassword);
      if (result.error) {
        setPasswordMsg(result.error.message ?? "Failed to change password");
      } else {
        setPasswordOk(true);
        setPasswordMsg("Password changed.");
        setCurrentPassword("");
        setNewPassword("");
      }
    } catch {
      setPasswordMsg("Something went wrong");
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-10">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {/* Profile */}
      <section className="space-y-4">
        <h2 className="text-base font-medium">Profile</h2>
        <form onSubmit={handleSaveName} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-muted-foreground">Email</label>
            <p className="mt-1 text-sm">{user.email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground">
              Display name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-copper"
            />
          </div>
          {profileError && <p className="text-sm text-destructive">{profileError}</p>}
          {saved && <p className="text-sm text-green-600">Saved.</p>}
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-copper px-4 py-1.5 text-sm font-medium text-white hover:bg-copper/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save name"}
          </button>
        </form>
      </section>

      {/* Password */}
      <section className="space-y-4">
        <h2 className="text-base font-medium">Password</h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-muted-foreground">
              Current password
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-copper"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground">
              New password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-copper"
            />
          </div>
          {passwordMsg && (
            <p className={`text-sm ${passwordOk ? "text-green-600" : "text-destructive"}`}>
              {passwordMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={passwordSaving}
            className="rounded bg-copper px-4 py-1.5 text-sm font-medium text-white hover:bg-copper/90 disabled:opacity-50"
          >
            {passwordSaving ? "Changing..." : "Change password"}
          </button>
        </form>
      </section>

      {/* Billing */}
      {billingEnabled && (
      <section className="space-y-3">
        <h2 className="text-base font-medium">Billing</h2>
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium capitalize">{billingPlan} plan</p>
              {billingStatus && (
                <p className="text-xs text-muted-foreground capitalize">{billingStatus}</p>
              )}
            </div>
            <Link
              href="/app/billing"
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Manage billing
            </Link>
          </div>
        </div>
      </section>
      )}

      {/* Workspaces */}
      <section className="space-y-3">
        <h2 className="text-base font-medium">Workspaces</h2>
        <div className="space-y-2">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className="flex items-center gap-3 rounded-lg border border-border p-3"
            >
              <div
                className="h-3 w-3 flex-shrink-0 rounded-full"
                style={{ backgroundColor: ws.color }}
              />
              <span className="text-sm font-medium">{ws.name}</span>
              <span className="ml-auto text-xs text-muted-foreground capitalize">
                {ws.kind}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Web History */}
      <section className="space-y-3">
        <h2 className="text-base font-medium">Web History</h2>
        <p className="text-sm text-muted-foreground">
          Keep your browsing history in Nexalog instead of Google. Captured by the
          browser extension; tracking params are stripped, and entries auto-delete
          after the retention window.
        </p>

        <label className="flex items-center gap-3 rounded-lg border border-border p-3">
          <input
            type="checkbox"
            checked={histOn}
            onChange={(e) => {
              setHistOn(e.target.checked);
              saveHistory({ savePageVisits: e.target.checked });
            }}
            className="h-4 w-4 accent-copper"
          />
          <span className="text-sm font-medium">Save my browsing history to Nexalog</span>
        </label>

        <div>
          <label htmlFor="history-denylist" className="block text-sm font-medium text-muted-foreground">
            Excluded sites (one host per line — e.g. bank.com)
          </label>
          <textarea
            id="history-denylist"
            value={denylist}
            onChange={(e) => setDenylist(e.target.value)}
            rows={3}
            placeholder="mybank.com&#10;mail.proton.me"
            className="mt-1 w-full rounded border border-border bg-card px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-copper"
          />
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="history-retention" className="text-sm font-medium text-muted-foreground">
            Keep history for
          </label>
          <input
            id="history-retention"
            type="number"
            min={1}
            max={3650}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            className="w-20 rounded border border-border bg-card px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-copper"
          />
          <span className="text-sm text-muted-foreground">days</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => saveHistory()}
            disabled={histSaving}
            className="rounded bg-copper px-4 py-1.5 text-sm font-medium text-white hover:bg-copper/90 disabled:opacity-50"
          >
            {histSaving ? "Saving..." : "Save history settings"}
          </button>
          {histSaved && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </section>

      {/* Account */}
      <section className="space-y-2">
        <h2 className="text-base font-medium">Account</h2>
        <div>
          <label className="text-xs font-medium text-muted-foreground">User ID</label>
          <p className="font-mono text-xs text-muted-foreground">{user.id}</p>
        </div>
      </section>

      {/* Data export */}
      <section className="space-y-3">
        <h2 className="text-base font-medium">Your data</h2>
        <p className="text-sm text-muted-foreground">
          Download everything you have put into Nexalog as a single ZIP — notes as
          markdown with Obsidian-compatible frontmatter, captures as CSV, links as
          JSON, journal as markdown. See ADR-0009 for the format contract.
        </p>
        <a
          href="/api/export"
          download
          className="inline-block rounded border border-border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Download my data
        </a>
      </section>
    </div>
  );
}
