// SPDX-License-Identifier: MIT
import { getAuthUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import SettingsView from "./settings-view";
import { isBillingEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspaces = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.userId, user.id));

  const [prefs] = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, user.id));

  return (
    <SettingsView
      user={{ id: user.id, email: user.email ?? "", name: user.name ?? "" }}
      workspaces={workspaces}
      billingPlan={prefs?.stripePlan ?? "free"}
      billingStatus={prefs?.stripeSubscriptionStatus ?? null}
      billingEnabled={isBillingEnabled()}
      savePageVisits={prefs?.savePageVisits ?? false}
      historyDenylist={prefs?.historyDenylist ?? []}
      historyRetentionDays={prefs?.historyRetentionDays ?? 90}
    />
  );
}
