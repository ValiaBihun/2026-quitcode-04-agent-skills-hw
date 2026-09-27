"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getCurrentUser, getLead, getWorkspace } from "@/lib/data";
import { parseNoteForm, type NoteField } from "@/lib/note-form";

export type NoteFormState =
  | { status: "idle" }
  | { status: "invalid"; errors: Partial<Record<NoteField, string>>; values: { text: string } }
  | { status: "ok" }
  | { status: "error"; values: { text: string } };

export async function addLeadNote(
  _prevState: NoteFormState,
  formData: FormData,
): Promise<NoteFormState> {
  const user = await getCurrentUser();

  const parsed = parseNoteForm(formData);
  // Every failure hands the typed text back, so the form can keep it.
  const typed = { text: parsed ? (parsed.ok ? parsed.data.text : parsed.values.text) : "" };
  if (!parsed) return { status: "error", values: typed };
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values: parsed.values };

  const { leadId, text } = parsed.data;
  const [workspace, lead] = await Promise.all([getWorkspace(user.workspaceSlug), getLead(leadId)]);
  if (!lead || lead.workspaceId !== workspace.id) return { status: "error", values: typed };

  const saved = await db.appendLeadNote(leadId, text);
  if (!saved) return { status: "error", values: typed };

  after(async () => {
    await logAudit("lead.note_added", leadId);
  });

  revalidatePath(`/dashboard/leads/${leadId}`);
  return { status: "ok" };
}
