import "server-only";
import { createHash } from "node:crypto";

export type N8nEvent = "lead-created" | "quote-request";

export type TriggerResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; reason: "misconfigured" | "rejected" | "unavailable" };

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
      if (response.ok) return { ok: true, status: response.status };
      if (response.status < 500) return { ok: false, status: response.status, reason: "rejected" }; // 4xx: fix, don't retry
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error"; // TimeoutError / TypeError — no URL, no token
      console.warn(`[n8n] -> ${event} failed=${name} attempt=${attempt} ms=${Date.now() - started} cid=${correlationId}`);
    }
    if (attempt <= RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }
  return { ok: false, status: lastStatus, reason: "unavailable" };
}

