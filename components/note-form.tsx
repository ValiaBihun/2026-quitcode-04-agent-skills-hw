"use client";

import { useActionState, useState } from "react";
import { addLeadNote, type NoteFormState } from "@/app/dashboard/actions";
import { NOTE_MAX_LENGTH } from "@/lib/note-form";

const initialState: NoteFormState = { status: "idle" };

const typedText = (state: NoteFormState) => (state.status === "invalid" || state.status === "error" ? state.values.text : "");

export function NoteForm({ leadId }: { leadId: string }) {
  const [state, formAction, pending] = useActionState(addLeadNote, initialState);
  const errors = state.status === "invalid" ? state.errors : {};

  // Controlled textarea: React 19 resets uncontrolled fields after every form action, so the
  // text lives in state. Without JS the server renders it from the action state instead.
  const [text, setText] = useState(() => typedText(state));
  const [shownState, setShownState] = useState(state);
  if (state !== shownState) {
    // adjust state while rendering (no effect): clear only after a note was saved
    setShownState(state);
    if (state.status === "ok") setText("");
  }

  return (
    <form
      action={formAction}
      noValidate
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm"
    >
      <h2 className="font-medium">Додати нотатку</h2>

      {state.status === "invalid" && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          Перевірте поля: {Object.values(errors).join("; ")}
        </div>
      )}

      <input type="hidden" name="leadId" value={leadId} />

      <div>
        <label htmlFor="note-text" className="block font-medium">
          Нотатка
        </label>
        <textarea
          id="note-text"
          name="text"
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-invalid={errors.text ? true : undefined}
          aria-describedby={errors.text ? "note-text-error note-text-hint" : "note-text-hint"}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 aria-[invalid=true]:border-red-500"
        />
        <p id="note-text-hint" className="mt-1 text-xs text-slate-500">
          До {NOTE_MAX_LENGTH} символів. Нотатку бачить лише команда.
        </p>
        {errors.text && (
          <p id="note-text-error" className="mt-1 text-xs text-red-600">
            Помилка: {errors.text}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p aria-live="polite" className="text-xs">
          {state.status === "ok" && <span className="text-green-700">Нотатку додано.</span>}
          {state.status === "error" && (
            <span className="text-red-700">Не вдалося зберегти нотатку. Спробуйте ще раз.</span>
          )}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Зберігаємо…" : "Додати нотатку"}
        </button>
      </div>
    </form>
  );
}
