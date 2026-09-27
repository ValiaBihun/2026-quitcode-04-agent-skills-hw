# Шаблони коду (Next.js 16, App Router, TypeScript)

Шаблони — відправна точка: імена записів, полів і функцій бази підлаштуйте під проєкт, контракт — ні.
Функції бази в шаблонах: `db.insertQuote`, `db.getQuoteByIdempotencyKey`, `db.updateQuote(id, patch, onlyIfStatus?)` —
остання оновлює лише тоді, коли поточний статус дорівнює `onlyIfStatus` (compare-and-set): колбек може
прийти раніше, ніж `after()` поставить `processing`, і термінальний статус не має перезаписатись.
Після змін — `scripts/check-contract.mjs`.

## `lib/n8n/client.ts`

```ts
import "server-only";
import { createHash } from "node:crypto";

export type N8nEvent = "lead-created" | "quote-request";

export type TriggerResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; reason: "misconfigured" | "rejected" | "no-callback" | "unavailable" };

const TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 3_000]; // up to 2 retries → 3 attempts

type EnvName = "N8N_WEBHOOK_BASE_URL" | "N8N_WEBHOOK_TOKEN" | "APP_BASE_URL" | "N8N_CALLBACK_SECRET";

function serverEnv(name: EnvName) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function callbackUrlFor(event: N8nEvent) {
  return `${serverEnv("APP_BASE_URL")}/api/n8n/${event}`;
}

// Missing configuration is not transient: report it once instead of retrying. A workflow that
// calls back also needs APP_BASE_URL and N8N_CALLBACK_SECRET — without the secret our callback
// route would answer 401 and the record would stay "processing" forever.
function readConfig(withCallback: boolean): { missing: EnvName[] } | { baseUrl: string; token: string } {
  const names: EnvName[] = [
    "N8N_WEBHOOK_BASE_URL",
    "N8N_WEBHOOK_TOKEN",
    ...(withCallback ? (["APP_BASE_URL", "N8N_CALLBACK_SECRET"] as const) : []),
  ];
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) return { missing };
  return { baseUrl: serverEnv("N8N_WEBHOOK_BASE_URL"), token: serverEnv("N8N_WEBHOOK_TOKEN") };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST {N8N_WEBHOOK_BASE_URL}/<event> with the team envelope.
 * Retries only network errors, timeouts, 5xx and 524 — always with the same idempotency key.
 */
export async function triggerWorkflow<T extends Record<string, unknown>>(options: {
  event: N8nEvent;
  data: T; // the minimum the workflow needs — never the whole DB row
  idempotencyKey: string; // created once per business operation and stored with the record
  correlationId: string;
  withCallback?: boolean; // async workflows (202 + callback)
}): Promise<TriggerResult> {
  const { event, idempotencyKey, correlationId } = options;
  const config = readConfig(Boolean(options.withCallback));
  if ("missing" in config) {
    console.error(`[n8n] -> ${event} not sent: ${config.missing.join(", ")} not set cid=${correlationId}`);
    return { ok: false, status: null, reason: "misconfigured" };
  }
  const url = `${config.baseUrl}/${event}`;
  const payload = JSON.stringify({
    version: 1,
    event,
    data: options.data,
    ...(options.withCallback ? { callbackUrl: callbackUrlFor(event) } : {}),
  });
  const bytes = Buffer.byteLength(payload);
  const sha = createHash("sha256").update(payload).digest("hex").slice(0, 16);

  let lastStatus: number | null = null;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    const started = Date.now();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-n8n-token": config.token,
          "idempotency-key": idempotencyKey,
          "x-correlation-id": correlationId,
        },
        body: payload,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastStatus = response.status;
      await response.body?.cancel(); // only the status code counts; the body is never read or parsed
      console.info(
        `[n8n] -> ${event} status=${response.status} attempt=${attempt} ms=${Date.now() - started} bytes=${bytes} sha256=${sha} cid=${correlationId}`,
      );
      // With a callback only 202 (Respond to Webhook) means "started, result follows". A plain 200
      // means the run ended without reaching Respond to Webhook — no callback will ever come.
      if (options.withCallback ? response.status === 202 : response.ok) return { ok: true, status: response.status };
      if (response.ok) return { ok: false, status: response.status, reason: "no-callback" }; // 2xx, but not 202
      if (response.status < 500) return { ok: false, status: response.status, reason: "rejected" }; // 4xx: fix, don't retry
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error"; // TimeoutError / TypeError — no URL, no token
      console.warn(`[n8n] -> ${event} failed=${name} attempt=${attempt} ms=${Date.now() - started} cid=${correlationId}`);
    }
    if (attempt <= RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }
  return { ok: false, status: lastStatus, reason: "unavailable" };
}
```

## `lib/n8n/idempotency.ts`

```ts
import "server-only";

// Demo store: one Node process. In production — a DB/KV table with a UNIQUE constraint,
// because serverless instances do not share memory.
const claimed = new Set<string>();

/** true — first time we see the key; false — duplicate. */
export async function claimKey(key: string): Promise<boolean> {
  if (claimed.has(key)) return false;
  claimed.add(key);
  return true;
}

/** Undo a claim when processing failed after it, so n8n's retry is not lost as a "duplicate". */
export async function releaseKey(key: string): Promise<void> {
  claimed.delete(key);
}
```

## `app/api/n8n/[event]/route.ts`

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { claimKey, releaseKey } from "@/lib/n8n/idempotency";
import { callbackHandlers, type CallbackData } from "@/lib/n8n/callbacks";

// Callback from n8n when a workflow result is ready. Public endpoint: we trust only the signature.

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SKEW_SECONDS = 300;

const reply = (status: number, body: Record<string, unknown> = {}) => Response.json(body, { status });

// Route Handlers have no body-size limit of their own, and request.text() would buffer the
// whole body first. Read the raw bytes ourselves and stop as soon as the limit is passed.
async function readRawBody(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function signatureMatches(timestamp: string, raw: string, header: string | null) {
  const secret = process.env.N8N_CALLBACK_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request, ctx: RouteContext<"/api/n8n/[event]">) {
  const { event } = await ctx.params;
  const handler = Object.hasOwn(callbackHandlers, event) ? callbackHandlers[event] : undefined;
  if (!handler) return reply(404, { error: "unknown event" }); // 1
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reply(415, { error: "unsupported media type" });
  }

  const raw = await readRawBody(request, MAX_BODY_BYTES); // 2+3 — raw bytes, at most 64 KiB; never request.json()
  if (raw === null) return reply(413, { error: "payload too large" });

  const timestamp = request.headers.get("x-n8n-timestamp") ?? "";
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!/^\d+$/.test(timestamp) || skew > MAX_SKEW_SECONDS) return reply(401, { error: "unauthorized" }); // 4
  if (!signatureMatches(timestamp, raw, request.headers.get("x-n8n-signature"))) {
    return reply(401, { error: "unauthorized" }); // 5
  }

  const key = request.headers.get("idempotency-key");
  if (!key) return reply(400, { error: "bad request" });
  if (!(await claimKey(key))) return reply(200, { duplicate: true }); // 6

  const cid = request.headers.get("x-correlation-id") ?? "-";
  try {
    const body = parseCallback(raw, event); // 7 — only now
    if (!body || key !== `${body.data.jobId}:${body.event}`) {
      await releaseKey(key);
      return reply(400, { error: "bad request" });
    }
    await handler(body.data); // 8 — persist BEFORE answering
  } catch {
    await releaseKey(key);
    console.warn(`[n8n] <- ${event} status=500 bytes=${Buffer.byteLength(raw)} cid=${cid}`);
    return reply(500, { error: "internal error" });
  }

  console.info(`[n8n] <- ${event} status=202 bytes=${Buffer.byteLength(raw)} cid=${cid}`);
  return reply(202, { ok: true }); // 9 — slow follow-ups (emails…) would go into after()
}

type CallbackBody = { version: 1; event: string; data: CallbackData };

function parseCallback(raw: string, event: string): CallbackBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const body = parsed as Partial<CallbackBody>;
  const data = body?.data;
  if (body?.version !== 1 || typeof body.event !== "string" || !body.event.startsWith(`${event}.`)) return null;
  if (!data || typeof data.jobId !== "string" || (data.status !== "completed" && data.status !== "failed")) return null;
  // the handler finds the record by it — a callback without it is malformed (400), not a server error
  if (typeof data.requestIdempotencyKey !== "string" || !data.requestIdempotencyKey.trim()) return null;
  return body as CallbackBody;
}
```

`lib/n8n/callbacks.ts` — одна функція на подію, яка **зберігає** стан (без побічних ефектів поза БД):

```ts
import "server-only";
import { db } from "@/lib/db";

export type CallbackData = {
  jobId: string;
  status: "completed" | "failed";
  requestIdempotencyKey: string; // our idempotency-key from the request that started the workflow
  result?: unknown;
  error?: unknown;
};

// One handler per event. It only persists state — no side effects outside the DB.
// Throwing → 500, the idempotency key is released and n8n's Retry On Fail can try again.
export const callbackHandlers: Record<string, (data: CallbackData) => Promise<void>> = {
  "quote-request": async (data) => {
    // Find the record by the idempotency key we sent (known before job_id arrives).
    const quote = await db.getQuoteByIdempotencyKey(data.requestIdempotencyKey);
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
```

## Server Action, що запускає воркфлоу

```ts
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
```

Сторінка статусу (`/quotes/[id]`) читає запис з бази й показує `queued` / `processing` / `ready` /
`failed`; поки не `ready` — підказка оновити сторінку (або `router.refresh()` з інтервалом у Client
Component).

## `.env.example`

```bash
# n8n (server-only; real values live in .env.local)
N8N_WEBHOOK_BASE_URL=http://127.0.0.1:5678/webhook
N8N_WEBHOOK_TOKEN=change-me-webhook-token
N8N_CALLBACK_SECRET=change-me-callback-secret
APP_BASE_URL=http://127.0.0.1:3000
```
