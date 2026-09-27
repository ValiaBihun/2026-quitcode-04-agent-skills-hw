import { BUDGET_OPTIONS } from "./lead-form";
import type { NewQuote } from "./types";

export type QuoteFormField = "company" | "email" | "description" | "budget";

// What the visitor typed, sent back after a validation error so nothing is lost.
export type QuoteFormValues = Record<QuoteFormField, string>;

export const EMPTY_QUOTE_VALUES: QuoteFormValues = { company: "", email: "", description: "", budget: "" };

export type QuoteParseResult =
  | { ok: true; data: NewQuote }
  | { ok: false; errors: Partial<Record<QuoteFormField, string>>; values: QuoteFormValues };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Longest accepted value per field; longer input is an error, never silently cut.
const MAX_LENGTH: Record<QuoteFormField, number> = { company: 120, email: 200, description: 4000, budget: 10 };
// Upper bound for echoing input back (the Server Action body itself is capped at 1 MB).
const ECHO_LIMIT = 10_000;

function text(formData: FormData, name: QuoteFormField) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function parseQuoteForm(formData: FormData): QuoteParseResult {
  const typed: QuoteFormValues = {
    company: text(formData, "company"),
    email: text(formData, "email"),
    description: text(formData, "description"),
    budget: text(formData, "budget"),
  };

  const errors: Partial<Record<QuoteFormField, string>> = {};
  const tooLong = (field: QuoteFormField) => typed[field].length > MAX_LENGTH[field];

  if (!typed.company) errors.company = "Вкажіть назву компанії";
  else if (tooLong("company")) errors.company = `Не довше ${MAX_LENGTH.company} символів`;

  if (tooLong("email") || !EMAIL_RE.test(typed.email)) errors.email = "Перевірте email";

  if (typed.description.length < 20) errors.description = "Опишіть задачу докладніше — хоча б кілька речень";
  else if (tooLong("description")) errors.description = `Не довше ${MAX_LENGTH.description} символів`;

  if (typed.budget && !BUDGET_OPTIONS.some((option) => option.value === typed.budget)) {
    errors.budget = "Оберіть бюджет зі списку";
  }

  if (Object.keys(errors).length > 0) {
    // the visitor's own input, unshortened, so it can be fixed rather than retyped
    const echo = (value: string) => value.slice(0, ECHO_LIMIT);
    return {
      ok: false,
      errors,
      values: {
        company: echo(typed.company),
        email: echo(typed.email),
        description: echo(typed.description),
        budget: errors.budget ? "" : typed.budget,
      },
    };
  }

  const data: NewQuote = {
    company: typed.company,
    email: typed.email.toLowerCase(),
    description: typed.description,
    budget: typed.budget ? Number(typed.budget) : null,
  };
  return { ok: true, data };
}
