import { BUDGET_OPTIONS } from "./lead-form";
import type { NewQuote } from "./types";

export type QuoteFormField = "company" | "email" | "description" | "budget";

export type QuoteParseResult =
  | { ok: true; data: NewQuote }
  | { ok: false; errors: Partial<Record<QuoteFormField, string>> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(formData: FormData, name: QuoteFormField, max = 200) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseQuoteForm(formData: FormData): QuoteParseResult {
  const data: NewQuote = {
    company: text(formData, "company", 120),
    email: text(formData, "email", 200).toLowerCase(),
    description: text(formData, "description", 4000),
    budget: null,
  };

  const errors: Partial<Record<QuoteFormField, string>> = {};

  if (!data.company) errors.company = "Вкажіть назву компанії";
  if (!EMAIL_RE.test(data.email)) errors.email = "Перевірте email";
  if (data.description.length < 20) errors.description = "Опишіть задачу докладніше — хоча б кілька речень";

  const budget = text(formData, "budget", 10);
  if (budget) {
    if (!BUDGET_OPTIONS.some((option) => option.value === budget)) {
      errors.budget = "Оберіть бюджет зі списку";
    } else {
      data.budget = Number(budget);
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, data };
}
