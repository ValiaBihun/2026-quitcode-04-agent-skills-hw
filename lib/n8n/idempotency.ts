import "server-only";

// Demo store: one Node process (survives module reloads in `next dev`, like lib/db.ts).
// In production — a DB/KV table with a UNIQUE constraint, because serverless instances
// do not share memory.
const globalForKeys = globalThis as unknown as { n8nClaimedKeys?: Set<string> };
const claimed = (globalForKeys.n8nClaimedKeys ??= new Set<string>());

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
