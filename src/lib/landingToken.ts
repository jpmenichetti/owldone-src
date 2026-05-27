// Lightweight obfuscated token for the public log-landing-visit endpoint.
// Not a security boundary — raises the bar against trivial replay/spam by
// requiring callers to compute a daily-rotating hash. The server computes
// the same value and rejects mismatches.

const SEED = "owldone-landing-v1";

function utcDayString(d = new Date()): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

export async function computeLandingToken(): Promise<string> {
  const input = `${SEED}:${utcDayString()}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 32);
}
