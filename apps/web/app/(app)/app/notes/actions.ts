"use server";

import { db, schema } from "@/lib/db";
import { redirect } from "next/navigation";
import { getTemplate } from "@/lib/note-templates";
import { getUserTimezone } from "@/lib/time/user-tz";

export async function createNote(formData: FormData) {
  const workspaceId = formData.get("workspaceId") as string;
  const userId = formData.get("userId") as string;
  const templateKey = (formData.get("templateKey") as string | null) ?? "blank";

  const template = getTemplate(templateKey);

  const title =
    template.key === "daily"
      ? new Date().toLocaleDateString(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: await getUserTimezone(),
        })
      : template.title ?? "";

  const [note] = await db
    .insert(schema.notes)
    .values({
      workspaceId,
      userId,
      title,
      content: template.body,
      kind: "note",
    })
    .returning();

  redirect(`/app/notes/${note.id}`);
}
