import "server-only";
import { createHash } from "node:crypto";

export type N8nEvent = "quote-request";

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
