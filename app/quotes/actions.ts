"use server";

import { after } from "next/server";
import { db } from "@/lib/db";
import { triggerWorkflow } from "@/lib/n8n/client";
import { parseQuoteForm, type QuoteFormField } from "@/lib/quote-form";

export type QuoteFormState =
  | { status: "idle" }
  | { status: "invalid"; errors: Partial<Record<QuoteFormField, string>> }
  | { status: "ok"; id: string };

export async function requestQuote(_prevState: QuoteFormState, formData: FormData): Promise<QuoteFormState> {
  // Public client-facing form, like the lead form on "/": no session check on purpose.
  // Everything is validated here on the server — the action is a public POST endpoint.
  const parsed = parseQuoteForm(formData);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

  // Stored as "queued" with its idempotencyKey/correlationId before n8n is ever called.
  const quote = await db.insertQuote(parsed.data);

  // The workflow takes 40–90 s: the user never waits for n8n. n8n answers 202 {job_id}
  // right away and calls /api/n8n/quote-request when the PDF is ready.
  after(async () => {
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
    await db.updateQuote(
      quote.id,
      result.ok ? { status: "processing", jobId: result.jobId } : { status: "failed" },
      "queued",
    );
  });

  return { status: "ok", id: quote.id };
}
