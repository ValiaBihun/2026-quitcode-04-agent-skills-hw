import "server-only";
import { db } from "@/lib/db";

export type CallbackData = {
  jobId: string;
  status: "completed" | "failed";
  requestIdempotencyKey?: string;
  result?: unknown;
  error?: unknown;
};

// One handler per event. It only persists state — no side effects outside the DB.
// Throwing → 500, the idempotency key is released and n8n's Retry On Fail can try again.
export const callbackHandlers: Record<string, (data: CallbackData) => Promise<void>> = {
  "quote-request": async (data) => {
    // Find the record by the idempotency key we sent (known before job_id arrives).
    const quote = data.requestIdempotencyKey ? await db.getQuoteByIdempotencyKey(data.requestIdempotencyKey) : null;
    if (!quote) throw new Error("unknown quote");

    const documentUrl = safeHttpUrl((data.result as { documentUrl?: unknown } | undefined)?.documentUrl);
    const ready = data.status === "completed" && documentUrl !== null;
    await db.updateQuote(quote.id, {
      status: ready ? "ready" : "failed",
      jobId: data.jobId,
      documentUrl: ready ? documentUrl : null,
    });
  },
};

// The link is rendered as <a href>, so accept only http(s) — never javascript: or data:.
function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
