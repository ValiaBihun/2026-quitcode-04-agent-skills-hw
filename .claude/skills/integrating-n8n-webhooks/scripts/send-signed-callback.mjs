#!/usr/bin/env node
// Sends a matrix of n8n-style callbacks to a running app and compares the status codes
// with the contract. Zero dependencies. Reads N8N_CALLBACK_SECRET from the environment
// (node --env-file=.env.local ...) and never prints it, the signatures or the bodies.

import { createHmac, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const USAGE = `send-signed-callback — callback matrix against POST /api/n8n/<event>

Usage:
  node --env-file=.env.local .claude/skills/integrating-n8n-webhooks/scripts/send-signed-callback.mjs \\
    --event quote-request --request-key <idempotency-key the app sent to n8n> [options]

Options:
  --url <base>          App base URL (default http://127.0.0.1:3000).
  --event <path>        Event path, e.g. quote-request (required).
  --request-key <key>   data.requestIdempotencyKey — the key of a real record, so the valid case
                        can be stored (required).
  --job-id <id>         data.jobId (default: random UUID).
  -h, --help            Show this help.

Environment: N8N_CALLBACK_SECRET (required; the same value the app uses).

Cases (expected status):
  valid                202   signed, fresh, key = <jobId>:<event>.completed
  duplicate            200   the same request again ({"duplicate": true})
  bad-signature        401   one hex digit changed
  old-timestamp        401   signed 10 minutes ago
  reformatted-body     401   body re-serialised with spaces after signing
  key-mismatch         400   signed body, idempotency-key that does not match it
  not-json             415   content-type text/plain
  unknown-event        404   /api/n8n/unknown-event
Exit code: 0 — every case matched; 1 — a mismatch; 2 — usage error.
`;

let args;
try {
  args = parseArgs({
    options: {
      url: { type: "string", default: "http://127.0.0.1:3000" },
      event: { type: "string" },
      "request-key": { type: "string" },
      "job-id": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  }).values;
} catch (error) {
  console.error(`send-signed-callback: ${error.message}`);
  process.exit(2);
}
if (args.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}
const secret = process.env.N8N_CALLBACK_SECRET;
if (!args.event || !args["request-key"] || !secret) {
  console.error("send-signed-callback: --event, --request-key and N8N_CALLBACK_SECRET are required (--help)");
  process.exit(2);
}

const event = `${args.event}.completed`;
const jobId = args["job-id"] ?? randomUUID();
const key = `${jobId}:${event}`;
const target = `${args.url.replace(/\/$/, "")}/api/n8n/${args.event}`;
const now = () => String(Math.floor(Date.now() / 1000));
const sign = (ts, raw) => `sha256=${createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex")}`;

const data = {
  jobId,
  status: "completed",
  correlationId: randomUUID(),
  requestIdempotencyKey: args["request-key"],
  result: { documentUrl: `https://files.example.test/n8n/${jobId}.pdf` },
  completedAt: new Date().toISOString(),
};
const raw = JSON.stringify({ version: 1, event, data });

function request({ body = raw, ts = now(), signature, idempotencyKey = key, contentType = "application/json", url = target }) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-n8n-timestamp": ts,
      "x-n8n-signature": signature ?? sign(ts, body),
      "idempotency-key": idempotencyKey,
      "x-correlation-id": data.correlationId,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
}

const validTs = now();
const validSig = sign(validTs, raw);
const flip = (sig) => sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
const oldTs = String(Number(now()) - 600);

const cases = [
  ["valid", 202, () => request({ ts: validTs, signature: validSig })],
  ["duplicate", 200, () => request({ ts: validTs, signature: validSig })],
  ["bad-signature", 401, () => request({ signature: flip(sign(now(), raw)) })],
  ["old-timestamp", 401, () => request({ ts: oldTs, signature: sign(oldTs, raw) })],
  ["reformatted-body", 401, () => {
    const ts = now();
    return request({ ts, signature: sign(ts, raw), body: JSON.stringify(JSON.parse(raw), null, 2) });
  }],
  ["key-mismatch", 400, () => request({ idempotencyKey: `${randomUUID()}:${event}` })],
  ["not-json", 415, () => request({ contentType: "text/plain" })],
  ["unknown-event", 404, () => request({ url: target.replace(/[^/]+$/, "unknown-event") })],
];

let mismatches = 0;
console.log(`send-signed-callback: POST ${target} event=${event}`);
for (const [name, expected, run] of cases) {
  let got;
  try {
    const response = await run();
    got = response.status;
    await response.arrayBuffer();
  } catch (error) {
    got = error.cause?.code ?? error.name;
  }
  const ok = got === expected;
  if (!ok) mismatches++;
  console.log(`${ok ? "OK  " : "FAIL"}  ${name.padEnd(17)} expected ${expected}, got ${got}`);
}
console.log(`Summary: ${cases.length - mismatches}/${cases.length} as expected`);
process.exit(mismatches ? 1 : 0);
