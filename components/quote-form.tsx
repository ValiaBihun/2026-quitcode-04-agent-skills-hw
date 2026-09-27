"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestQuote, type QuoteFormState } from "@/app/quotes/actions";
import { BUDGET_OPTIONS } from "@/lib/lead-form";

const initialState: QuoteFormState = { status: "idle" };

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export function QuoteForm() {
  const [state, formAction, pending] = useActionState(requestQuote, initialState);
  const router = useRouter();
  const errors = state.status === "invalid" ? state.errors : {};
  const createdId = state.status === "ok" ? state.id : null;

  useEffect(() => {
    if (createdId) router.push(`/quotes/${createdId}`);
  }, [createdId, router]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Компанія
          <input name="company" autoComplete="organization" className={inputClass} />
          {errors.company && <span className="mt-1 block text-xs text-red-600">{errors.company}</span>}
        </label>
        <label className="block text-sm font-medium">
          Email
          <input name="email" type="email" autoComplete="email" className={inputClass} />
          {errors.email && <span className="mt-1 block text-xs text-red-600">{errors.email}</span>}
        </label>
      </div>

      <label className="block text-sm font-medium">
        Опис задачі
        <textarea
          name="description"
          rows={6}
          placeholder="Що потрібно зробити, терміни, приклади, які подобаються"
          className={inputClass}
        />
        {errors.description && <span className="mt-1 block text-xs text-red-600">{errors.description}</span>}
      </label>

      <label className="block text-sm font-medium">
        Бюджет
        <select name="budget" defaultValue="" className={inputClass}>
          {BUDGET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {errors.budget && <span className="mt-1 block text-xs text-red-600">{errors.budget}</span>}
      </label>

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
