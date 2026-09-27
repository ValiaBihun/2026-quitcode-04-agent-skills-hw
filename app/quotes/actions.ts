"use server";

import { after } from "next/server";
import { db } from "@/lib/db";
import { triggerWorkflow } from "@/lib/n8n/client";
import { parseQuoteForm, type QuoteFormField, type QuoteFormValues } from "@/lib/quote-form";

export type QuoteFormState =
  | { status: "idle" }
  | { status: "invalid"; errors: Partial<Record<QuoteFormField, string>>; values: QuoteFormValues }
  | { status: "ok"; id: string };

export async function requestQuote(_prevState: QuoteFormState, formData: FormData): Promise<QuoteFormState> {
  // Public client-facing form, like the lead form on "/": no session check on purpose.
  // Everything is validated here on the server — the action is a public POST endpoint.
  const parsed = parseQuoteForm(formData);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values: parsed.values };

  // Stored as "queued" with its idempotencyKey/correlationId before n8n is ever called.
  const quote = await db.insertQuote(parsed.data);

  // The workflow takes 40–90 s: the user never waits for n8n. n8n answers 202 {job_id}
  // right away and calls /api/n8n/quote-request when the PDF is ready.
  after(async () => {
    // n8n's answer counts only by status code; the job id arrives later, in the signed callback.
    let next: { status: "processing" } | { status: "failed" } = { status: "failed" };
    try {
      const result = await triggerWorkflow({
        event: "quote-request",
        // Minimum for the PDF: no email, IP or user agent.
        data: {
          quoteId: quote.id,
          company: quote.company,
          description: quote.description,
          budget: quote.budget,
        },
        idempotencyKey: quote.idempotencyKey,
        correlationId: quote.correlationId,
        withCallback: true,
      });
      if (result.ok) next = { status: "processing" };
    } catch (error) {
      // Never leave the quote stuck in "queued": anything unexpected ends as "failed".
      const name = error instanceof Error ? error.name : "Error";
      console.error(`[n8n] -> quote-request crashed=${name} cid=${quote.correlationId}`);
    }
    // Only from "queued": a fast callback may already have set "ready" / "failed".
    await db.updateQuote(quote.id, next, "queued");
  });

  return { status: "ok", id: quote.id };
}
