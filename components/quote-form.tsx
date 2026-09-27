"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestQuote, type QuoteFormState } from "@/app/quotes/actions";
import { BUDGET_OPTIONS } from "@/lib/lead-form";
import { EMPTY_QUOTE_VALUES, type QuoteFormField, type QuoteFormValues } from "@/lib/quote-form";

const initialState: QuoteFormState = { status: "idle" };

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 aria-[invalid=true]:border-red-500";

export function QuoteForm() {
  const [state, formAction, pending] = useActionState(requestQuote, initialState);
  const router = useRouter();
  const errors = state.status === "invalid" ? state.errors : {};
  const createdId = state.status === "ok" ? state.id : null;

  // Controlled fields: React 19 resets uncontrolled inputs after every form action, so the
  // typed values live in state. Without JS the server renders them from the action state.
  const [values, setValues] = useState<QuoteFormValues>(
    state.status === "invalid" ? state.values : EMPTY_QUOTE_VALUES,
  );
  const [shownState, setShownState] = useState(state);
  if (state !== shownState) {
    // adjust state while rendering (no effect): show exactly what the server received
    setShownState(state);
    if (state.status === "invalid") setValues(state.values);
  }
  const set = (field: QuoteFormField) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  // aria wiring for one field: invalid flag + the id of its error message
  const describe = (field: QuoteFormField) =>
    errors[field] ? { "aria-invalid": true, "aria-describedby": `quote-${field}-error` } : {};
  const fieldError = (field: QuoteFormField) =>
    errors[field] && (
      <p id={`quote-${field}-error`} className="mt-1 text-xs text-red-600">
        Помилка: {errors[field]}
      </p>
    );

  useEffect(() => {
    if (createdId) router.push(`/quotes/${createdId}`);
  }, [createdId, router]);

  // With JS, submit without React's automatic form reset: it re-selects the first <option> of a
  // controlled <select> and the budget would be lost. `action` stays for the no-JS path.
  const [, startTransition] = useTransition();
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form action={formAction} onSubmit={submit} className="space-y-4" noValidate>
      {state.status === "invalid" && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Перевірте поля: {Object.values(errors).join("; ")}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="quote-company" className="block text-sm font-medium">
            Компанія
          </label>
          <input
            id="quote-company"
            name="company"
            autoComplete="organization"
            value={values.company}
            onChange={set("company")}
            className={inputClass}
            {...describe("company")}
          />
          {fieldError("company")}
        </div>
        <div>
          <label htmlFor="quote-email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="quote-email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set("email")}
            className={inputClass}
            {...describe("email")}
          />
          {fieldError("email")}
        </div>
      </div>

      <div>
        <label htmlFor="quote-description" className="block text-sm font-medium">
          Опис задачі
        </label>
        <textarea
          id="quote-description"
          name="description"
          rows={6}
          placeholder="Що потрібно зробити, терміни, приклади, які подобаються"
          value={values.description}
          onChange={set("description")}
          className={inputClass}
          {...describe("description")}
        />
        {fieldError("description")}
      </div>

      <div>
        <label htmlFor="quote-budget" className="block text-sm font-medium">
          Бюджет
        </label>
        <select
          id="quote-budget"
          name="budget"
          value={values.budget}
          onChange={set("budget")}
          className={inputClass}
          {...describe("budget")}
        >
          {BUDGET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {fieldError("budget")}
      </div>

      <button
        type="submit"
        disabled={pending || createdId !== null}
        className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending || createdId ? "Надсилаємо…" : "Запросити кошторис"}
      </button>
    </form>
  );
}
