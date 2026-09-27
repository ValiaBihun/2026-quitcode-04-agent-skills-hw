#!/usr/bin/env node
// Static check of a Next.js project against the team's Next.js <-> n8n contract.
// Zero dependencies (node:fs, node:path, node:child_process). Never reads .env files
// other than .env.example and never prints their values.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const USAGE = `check-contract — static check of the Next.js <-> n8n contract

Usage:
  node .claude/skills/integrating-n8n-webhooks/scripts/check-contract.mjs [options]

Options:
  --root <dir>            Project to check (default: current directory).
  --changed-since <ref>   Only files changed since <ref> (plus new untracked files); in
                          existing files only the changed lines. Needs git in <root>.
  -h, --help              Show this help.

Checks (each prints PASS or FAIL; FAIL lists file:line):
  C1   No test webhook URL (/webhook-test/) in code or .env.example
  C2   No N8N_* variable with the NEXT_PUBLIC_ prefix
  C3   n8n webhook env vars are read only in lib/n8n/client.ts
  C4   lib/n8n/client.ts exists for every n8n call and starts with import 'server-only'
  C5   Every fetch to n8n has a timeout (signal: AbortSignal.timeout(...))
  C6   Every n8n call sends x-n8n-token, idempotency-key and x-correlation-id
  C7   Callback route reads the raw body; no .json() / JSON.parse before the signature check
  C8   Callback signature compared with crypto.timingSafeEqual, never === / !==
  C9   Callback route checks x-n8n-timestamp and idempotency-key
  C10  No export const runtime = 'edge'
  C11  .env.example: contract keys present, secrets are change-me-..., base URL ends in /webhook
  C12  No request bodies or personal data in console.* of n8n-related files

Exit code: 0 — no FAIL; 1 — at least one FAIL; 2 — usage or git error.
`;

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", ".claude", ".agents", ".cursor", ".codex",
  "tools", "docs", "materials", "coverage", "out", "build", "dist",
]);
const CLIENT_MODULE = "lib/n8n/client.ts";
const WEBHOOK_ENV_RE = /process\.env\.(N8N_WEBHOOK_(?:BASE_URL|URL|TOKEN))|\bN8N_WEBHOOK_(?:BASE_URL|URL|TOKEN)\b/g;
const REQUIRED_ENV = ["N8N_WEBHOOK_BASE_URL", "N8N_WEBHOOK_TOKEN", "N8N_CALLBACK_SECRET", "APP_BASE_URL"];
const SECRET_ENV = ["N8N_WEBHOOK_TOKEN", "N8N_CALLBACK_SECRET"];

function fail(message) {
  console.error(`check-contract: ${message}\nRun with --help for usage.`);
  process.exit(2);
}

let args;
try {
  args = parseArgs({
    options: {
      root: { type: "string", default: "." },
      "changed-since": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  }).values;
} catch (error) {
  fail(error.message);
}
if (args.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const root = path.resolve(args.root);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`--root is not a directory: ${root}`);

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (CODE_EXT.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// Blank out // and /* */ comments (keeping newlines, so line numbers stay) — a comment
// saying "never request.json() here" is not a violation. Strings are left untouched.
function stripComments(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) out += text[++i];
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") (out += " "), i++;
      if (i < text.length) out += "\n";
    } else if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) (out += text[i] === "\n" ? "\n" : " "), i++;
      out += "  ";
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

const files = new Map(); // rel path -> text without comments
for (const abs of walk(root)) files.set(rel(abs), stripComments(fs.readFileSync(abs, "utf8")));
const envExamplePath = path.join(root, ".env.example");
const envExample = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, "utf8") : null;

// ---------------------------------------------------------------------------
// --changed-since: which files / lines count
// ---------------------------------------------------------------------------

let changed = null; // null = everything counts; else Map(rel -> Set(lines) | "all")
if (args["changed-since"]) {
  const ref = args["changed-since"];
  const git = (gitArgs) => {
    try {
      return execFileSync("git", ["-C", root, ...gitArgs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      fail(`git ${gitArgs.join(" ")} failed: ${error.stderr?.toString().trim() || error.message}`);
    }
  };
  changed = new Map();
  let current = null;
  for (const line of git(["diff", "-U0", "--no-color", ref, "--", "."]).split("\n")) {
    if (line.startsWith("+++ ")) {
      current = line === "+++ /dev/null" ? null : line.slice(6);
      if (current && !changed.has(current)) changed.set(current, new Set());
    } else if (current && line.startsWith("@@")) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      for (let i = 0; i < count; i++) changed.get(current).add(start + i);
    }
  }
  for (const file of git(["ls-files", "--others", "--exclude-standard"]).split("\n")) {
    if (file) changed.set(file, "all");
  }
}

function counts(file, line) {
  if (!changed) return true;
  const lines = changed.get(file);
  if (!lines) return false;
  if (lines === "all" || line === 0) return true; // line 0 = the file as a whole
  return lines.has(line);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// Text of a call's argument list starting at the "(" at `open`, with balanced parens.
function callArgs(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

const usesWebhookEnv = (text) => new RegExp(WEBHOOK_ENV_RE.source).test(text);

// fetch(...) calls that go to n8n: every fetch in the client module and in any file that
// reads a webhook env var, plus fetches whose arguments mention n8n or a webhook path.
function n8nFetches(file, text) {
  const all = file === CLIENT_MODULE || usesWebhookEnv(text);
  const out = [];
  for (const m of text.matchAll(/\bfetch\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const argsText = callArgs(text, open);
    if (all || /N8N_|n8n|\/webhook/.test(argsText)) out.push({ line: lineOf(text, m.index), argsText });
  }
  return out;
}

const isCallbackRoute = (file, text) =>
  /(^|\/)app\/.*\/route\.(ts|js|mjs)$/.test(file) && /x-n8n-signature|N8N_CALLBACK_SECRET/.test(text);

const n8nRelated = (file, text) =>
  file === CLIENT_MODULE || usesWebhookEnv(text) || isCallbackRoute(file, text) || n8nFetches(file, text).length > 0;

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const results = [];
function check(id, title, run) {
  const findings = [];
  const note = run((file, line, message) => findings.push({ file, line, message }));
  const kept = findings.filter((f) => counts(f.file, f.line));
  results.push({ id, title, findings: kept, note: typeof note === "string" ? note : "" });
}

check("C1", "No test webhook URL (/webhook-test/) in code or .env.example", (report) => {
  for (const [file, text] of files) {
    for (const m of text.matchAll(/\/webhook-test\b/g)) report(file, lineOf(text, m.index), "test URL /webhook-test/");
  }
  if (envExample) {
    for (const m of envExample.matchAll(/\/webhook-test\b/g)) {
      report(".env.example", lineOf(envExample, m.index), "test URL /webhook-test/");
    }
  }
});

check("C2", "No N8N_* variable with the NEXT_PUBLIC_ prefix", (report) => {
  const sources = [...files];
  if (envExample) sources.push([".env.example", envExample]);
  for (const [file, text] of sources) {
    for (const m of text.matchAll(/NEXT_PUBLIC_N8N_\w*/g)) {
      report(file, lineOf(text, m.index), `${m[0]} would be inlined into the client bundle`);
    }
  }
});

check("C3", `n8n webhook env vars are read only in ${CLIENT_MODULE}`, (report) => {
  for (const [file, text] of files) {
    if (file === CLIENT_MODULE) continue;
    for (const m of text.matchAll(WEBHOOK_ENV_RE)) {
      report(file, lineOf(text, m.index), `${m[1] ?? m[0]} outside ${CLIENT_MODULE}`);
    }
  }
});

check("C4", `${CLIENT_MODULE} exists for every n8n call and starts with import 'server-only'`, (report) => {
  const client = files.get(CLIENT_MODULE);
  if (!client) {
    let calls = 0;
    for (const [file, text] of files) {
      for (const f of n8nFetches(file, text)) {
        calls++;
        report(file, f.line, `n8n call, but ${CLIENT_MODULE} does not exist`);
      }
    }
    return calls ? "" : `(n/a: no n8n calls and no ${CLIENT_MODULE})`;
  }
  const firstCode = client
    .split("\n")
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .find((l) => l.text && !l.text.startsWith("//") && !l.text.startsWith("/*") && !l.text.startsWith("*"));
  if (!firstCode || !/^import\s+["']server-only["'];?$/.test(firstCode.text)) {
    report(CLIENT_MODULE, firstCode?.line ?? 1, "first statement is not import 'server-only'");
  }
});

check("C5", "Every fetch to n8n has a timeout (signal: AbortSignal.timeout(...))", (report) => {
  let calls = 0;
  for (const [file, text] of files) {
    for (const f of n8nFetches(file, text)) {
      calls++;
      if (!/AbortSignal\.timeout\s*\(|\bsignal\s*[:,}]/.test(f.argsText)) report(file, f.line, "fetch without signal/timeout");
    }
  }
  return calls ? "" : "(n/a: no n8n fetch calls)";
});

check("C6", "Every n8n call sends x-n8n-token, idempotency-key and x-correlation-id", (report) => {
  let calls = 0;
  for (const [file, text] of files) {
    const fetches = n8nFetches(file, text);
    if (!fetches.length) continue;
    calls += fetches.length;
    const missing = ["x-n8n-token", "idempotency-key", "x-correlation-id"].filter(
      (h) => !new RegExp(`["'\`]${h}["'\`]`, "i").test(text),
    );
    if (missing.length) report(file, fetches[0].line, `headers missing: ${missing.join(", ")}`);
  }
  return calls ? "" : "(n/a: no n8n fetch calls)";
});

const callbackRoutes = [...files].filter(([file, text]) => isCallbackRoute(file, text));
const noRoutes = "(n/a: no callback route with x-n8n-signature / N8N_CALLBACK_SECRET)";

check("C7", "Callback route reads the raw body; no .json() / JSON.parse before the signature check", (report) => {
  for (const [file, text] of callbackRoutes) {
    for (const m of text.matchAll(/(?<!Response)(?<!NextResponse)\.json\s*\(\s*\)/g)) {
      report(file, lineOf(text, m.index), "request body parsed with .json() — the signature needs the raw bytes");
    }
    if (!/\.text\s*\(\s*\)|\.arrayBuffer\s*\(\s*\)/.test(text)) report(file, 0, "raw body is never read (.text() / .arrayBuffer())");
    const verify = text.search(/timingSafeEqual/);
    for (const m of text.matchAll(/JSON\.parse\s*\(/g)) {
      if (verify === -1 || m.index < verify) report(file, lineOf(text, m.index), "JSON.parse before the signature is verified");
    }
  }
  return callbackRoutes.length ? "" : noRoutes;
});

check("C8", "Callback signature compared with crypto.timingSafeEqual, never === / !==", (report) => {
  for (const [file, text] of callbackRoutes) {
    if (!/timingSafeEqual/.test(text)) report(file, 0, "no crypto.timingSafeEqual");
    text.split("\n").forEach((line, i) => {
      if (/[!=]==?/.test(line) && /signature|digest|hmac|expected/i.test(line) &&
          !/\.length|typeof|null|undefined|startsWith/.test(line) && /[!=]==/.test(line)) {
        report(file, i + 1, "signature compared with ===/!==");
      }
    });
  }
  return callbackRoutes.length ? "" : noRoutes;
});

check("C9", "Callback route checks x-n8n-timestamp and idempotency-key", (report) => {
  for (const [file, text] of callbackRoutes) {
    for (const h of ["x-n8n-timestamp", "idempotency-key"]) {
      if (!new RegExp(`["'\`]${h}["'\`]`, "i").test(text)) report(file, 0, `header ${h} is never read`);
    }
  }
  return callbackRoutes.length ? "" : noRoutes;
});

check("C10", "No export const runtime = 'edge'", (report) => {
  for (const [file, text] of files) {
    for (const m of text.matchAll(/export\s+const\s+runtime\s*=\s*["']edge["']/g)) {
      report(file, lineOf(text, m.index), "edge runtime is deprecated in Next.js 16 and has no node:crypto");
    }
  }
});

check("C11", ".env.example: contract keys present, secrets are change-me-..., base URL ends in /webhook", (report) => {
  const anyN8n = [...files].some(([file, text]) => n8nRelated(file, text));
  if (!envExample) {
    if (anyN8n) report(".env.example", 0, ".env.example is missing");
    return anyN8n ? "" : "(n/a: no n8n code and no .env.example)";
  }
  const vars = new Map();
  envExample.split("\n").forEach((line, i) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) vars.set(m[1], { value: m[2].trim().replace(/^["']|["']$/g, ""), line: i + 1 });
  });
  if (anyN8n) {
    for (const key of REQUIRED_ENV) if (!vars.has(key)) report(".env.example", 0, `${key} is missing`);
  }
  for (const key of SECRET_ENV) {
    const v = vars.get(key);
    if (v && !v.value.startsWith("change-me-")) report(".env.example", v.line, `${key} must be change-me-... (value not printed)`);
  }
  const base = vars.get("N8N_WEBHOOK_BASE_URL");
  if (base && !/\/webhook\/?$/.test(base.value)) report(".env.example", base.line, "N8N_WEBHOOK_BASE_URL must end in /webhook");
});

check("C12", "No request bodies or personal data in console.* of n8n-related files", (report) => {
  for (const [file, text] of files) {
    if (!n8nRelated(file, text)) continue;
    for (const m of text.matchAll(/console\.(log|info|warn|error|debug)\s*\(/g)) {
      // logging the size of a body is part of the contract — only its content is forbidden
      const argsText = callArgs(text, m.index + m[0].length - 1)
        .replace(/Buffer\.byteLength\s*\([^)]*\)/g, "")
        .replace(/\b\w+\.length\b/g, "");
      const bad = /\b(formData|raw|rawBody|body|payload|envelope|email|phone|fullName)\b|JSON\.stringify|\.headers\b|process\.env/.exec(argsText);
      if (bad) report(file, lineOf(text, m.index), `console.${m[1]} logs "${bad[0]}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const scope = changed ? ` changed-since=${args["changed-since"]} (${changed.size} changed file(s))` : "";
console.log(`check-contract: root=${root} files=${files.size}${scope}`);
let failed = 0;
for (const r of results) {
  const ok = r.findings.length === 0;
  if (!ok) failed++;
  console.log(`${r.id.padEnd(4)} ${ok ? "PASS" : "FAIL"}  ${r.title}${ok && r.note ? ` ${r.note}` : ""}`);
  for (const f of r.findings) console.log(`       ${f.file}${f.line ? `:${f.line}` : ""}  ${f.message}`);
}
console.log(`Summary: ${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
