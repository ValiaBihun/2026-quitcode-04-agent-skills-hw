export const NOTE_MAX_LENGTH = 500;

export type NoteField = "text";

export type NoteFormData = {
  leadId: string;
  text: string;
};

export type ParseNoteResult =
  | { ok: true; data: NoteFormData }
  | { ok: false; errors: Partial<Record<NoteField, string>>; values: { text: string } };

const LEAD_ID_RE = /^lead_\d{4,}$/;

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function parseNoteForm(formData: FormData): ParseNoteResult | null {
  const leadId = field(formData, "leadId").trim();
  // A tampered hidden field is not a user mistake: no field error, just reject.
  if (!LEAD_ID_RE.test(leadId)) return null;

  const raw = field(formData, "text").trim();
  const text = raw.slice(0, NOTE_MAX_LENGTH);
  const errors: Partial<Record<NoteField, string>> = {};

  if (!raw) errors.text = "Напишіть текст нотатки";
  else if (raw.length > NOTE_MAX_LENGTH) errors.text = `Не більше ${NOTE_MAX_LENGTH} символів`;

  return Object.keys(errors).length > 0
    ? { ok: false, errors, values: { text } }
    : { ok: true, data: { leadId, text } };
}
