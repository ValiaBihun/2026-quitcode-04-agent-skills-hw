# Шаблони коду (Next.js 16, App Router, TypeScript)

Шаблони — відправна точка: імена записів, полів і функцій бази підлаштуйте під проєкт, контракт — ні.
Після змін — `scripts/check-contract.mjs`.

## `lib/n8n/client.ts`

```ts
import "server-only";
import { createHash } from "node:crypto";

export type N8nEvent = "lead-created" | "quote-request";

export type TriggerResult =
  | { ok: true; status: number; jobId: string | null }
  | { ok: false; status: number | null; reason: "rejected" | "unavailable" };

const TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 3_000]; // up to 2 retries → 3 attempts

function serverEnv(name: "N8N_WEBHOOK_BASE_URL" | "N8N_WEBHOOK_TOKEN" | "APP_BASE_URL") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function callbackUrlFor(event: N8nEvent) {
  return `${serverEnv("APP_BASE_URL")}/api/n8n/${event}`;
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
  const url = `${serverEnv("N8N_WEBHOOK_BASE_URL")}/${event}`;
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
          "x-n8n-token": serverEnv("N8N_WEBHOOK_TOKEN"),
          "idempotency-key": idempotencyKey,
          "x-correlation-id": correlationId,
        },
        body: payload,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastStatus = response.status;
      const text = await response.text(); // status decides; the text is read only for job_id
      console.info(
        `[n8n] -> ${event} status=${response.status} attempt=${attempt} ms=${Date.now() - started} bytes=${bytes} sha256=${sha} cid=${correlationId}`,
      );
      if (response.ok) return { ok: true, status: response.status, jobId: readJobId(text) };
      if (response.status < 500) return { ok: false, status: response.status, reason: "rejected" }; // 4xx: fix, don't retry
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error"; // TimeoutError / TypeError — no URL, no token
      console.warn(`[n8n] -> ${event} failed=${name} attempt=${attempt} ms=${Date.now() - started} cid=${correlationId}`);
    }
    if (attempt <= RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }
  return { ok: false, status: lastStatus, reason: "unavailable" };
}

function readJobId(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const id = (parsed as { job_id?: unknown })?.job_id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
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
import { callbackHandlers } from "@/lib/n8n/callbacks";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SKEW_SECONDS = 300;

const reply = (status: number, body: Record<string, unknown> = {}) => Response.json(body, { status });

function signatureMatches(timestamp: string, raw: string, header: string | null) {
  const secret = process.env.N8N_CALLBACK_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request, ctx: RouteContext<"/api/n8n/[event]">) {
  const { event } = await ctx.params;
  const handler = callbackHandlers[event];
  if (!handler) return reply(404, { error: "unknown event" }); // 1
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reply(415, { error: "unsupported media type" });
  }

  const raw = await request.text(); // 2 — raw bytes; never request.json() here
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return reply(413, { error: "payload too large" }); // 3

  const timestamp = request.headers.get("x-n8n-timestamp") ?? "";
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!/^\d+$/.test(timestamp) || skew > MAX_SKEW_SECONDS) return reply(401, { error: "unauthorized" }); // 4
  if (!signatureMatches(timestamp, raw, request.headers.get("x-n8n-signature"))) {
    return reply(401, { error: "unauthorized" }); // 5
  }

  const key = request.headers.get("idempotency-key");
  if (!key) return reply(400, { error: "bad request" });
  if (!(await claimKey(key))) return reply(200, { duplicate: true }); // 6

  try {
    const body = parseCallback(raw, event); // 7 — only now
    if (!body || key !== `${body.data.jobId}:${body.event}`) {
      await releaseKey(key);
      return reply(400, { error: "bad request" });
    }
    await handler(body.data); // 8 — persist BEFORE answering
  } catch {
    await releaseKey(key);
    return reply(500, { error: "internal error" });
  }

  const cid = request.headers.get("x-correlation-id") ?? "-";
  console.info(`[n8n] <- ${event} status=202 bytes=${Buffer.byteLength(raw)} cid=${cid}`);
  return reply(202, { ok: true }); // 9 — slow follow-ups (emails…) go into after()
}

type CallbackBody = {
  version: 1;
  event: string;
  data: { jobId: string; status: "completed" | "failed"; requestIdempotencyKey?: string; result?: unknown; error?: unknown };
};

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
  return body as CallbackBody;
}
```

`lib/n8n/callbacks.ts` — одна функція на подію, яка **зберігає** стан (без побічних ефектів поза БД):

```ts
import "server-only";
import { db } from "@/lib/db";

type CallbackData = { jobId: string; status: "completed" | "failed"; requestIdempotencyKey?: string; result?: unknown };

export const callbackHandlers: Record<string, (data: CallbackData) => Promise<void>> = {
  "quote-request": async (data) => {
    // find the record by the idempotency key we sent (known before job_id arrives)
    const quote = data.requestIdempotencyKey ? await db.getQuoteByIdempotencyKey(data.requestIdempotencyKey) : null;
    if (!quote) throw new Error("unknown quote"); // → 500, key released, n8n retries
    const documentUrl = (data.result as { documentUrl?: unknown } | undefined)?.documentUrl;
    await db.updateQuote(quote.id, {
      status: data.status === "completed" ? "ready" : "failed",
      jobId: data.jobId,
      documentUrl: typeof documentUrl === "string" ? documentUrl : null,
    });
  },
};
```

## Server Action, що запускає воркфлоу

```ts
"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { triggerWorkflow } from "@/lib/n8n/client";
import { db } from "@/lib/db";

export type QuoteFormState =
  | { status: "idle" }
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "ok"; id: string };

export async function requestQuote(_prev: QuoteFormState, formData: FormData): Promise<QuoteFormState> {
  // Server Action = public POST endpoint (server-auth-actions): session/permission checks here;
  // a public website form skips the session check deliberately — say so in a comment.
  const parsed = parseQuoteForm(formData); // validate everything on the server
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

  const quote = await db.insertQuote({
    ...parsed.data,
    status: "queued",
    idempotencyKey: randomUUID(), // once per operation, stored with the record
    correlationId: randomUUID(),
  });

  // The user never waits for n8n (server-after-nonblocking).
  after(async () => {
    const result = await triggerWorkflow({
      event: "quote-request",
      data: { quoteId: quote.id, company: quote.company, budget: quote.budget }, // minimum only
      idempotencyKey: quote.idempotencyKey,
      correlationId: quote.correlationId,
      withCallback: true,
    });
    await db.updateQuote(quote.id, result.ok ? { status: "processing", jobId: result.jobId } : { status: "failed" });
  });

  return { status: "ok", id: quote.id }; // not the DB row
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
