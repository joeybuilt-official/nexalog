// SPDX-License-Identifier: MIT
import { redirect } from "next/navigation";
import { userTodayStr } from "@/lib/time/user-tz";

export default async function JournalTodayPage() {
  const today = await userTodayStr();
  redirect(`/app/journal/${today}`);
}
