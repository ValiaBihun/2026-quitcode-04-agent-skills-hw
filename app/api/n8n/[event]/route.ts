import { createHmac, timingSafeEqual } from "node:crypto";
import { claimKey, releaseKey } from "@/lib/n8n/idempotency";
import { callbackHandlers, type CallbackData } from "@/lib/n8n/callbacks";

// Callback from n8n when a workflow result is ready. Public endpoint: we trust only the signature.

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
  const handler = Object.hasOwn(callbackHandlers, event) ? callbackHandlers[event] : undefined;
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
  return body as CallbackBody;
}
