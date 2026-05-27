import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeLandingToken } from "./landingToken";

describe("computeLandingToken", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a 32-character lowercase hex string", async () => {
    const token = await computeLandingToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("is deterministic within the same UTC day", async () => {
    const a = await computeLandingToken();
    const b = await computeLandingToken();
    expect(a).toBe(b);
  });

  it("changes when the UTC day changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-27T12:00:00Z"));
    const day1 = await computeLandingToken();

    vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
    const day2 = await computeLandingToken();

    expect(day1).not.toBe(day2);
  });

  it("matches the edge-function expected token format (same seed/day algo)", async () => {
    vi.useFakeTimers();
    const fixed = new Date("2026-01-15T08:00:00Z");
    vi.setSystemTime(fixed);

    const token = await computeLandingToken();

    // Recompute locally with the same algorithm the server uses.
    const day = `${fixed.getUTCFullYear()}-${fixed.getUTCMonth() + 1}-${fixed.getUTCDate()}`;
    const bytes = new TextEncoder().encode(`owldone-landing-v1:${day}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const expected = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);

    expect(token).toBe(expected);
  });

  it("uses UTC (not local time) when crossing midnight in non-UTC zones", async () => {
    vi.useFakeTimers();
    // 23:00 UTC -> still day N
    vi.setSystemTime(new Date("2026-03-10T23:00:00Z"));
    const before = await computeLandingToken();
    // 01:00 UTC next day -> day N+1
    vi.setSystemTime(new Date("2026-03-11T01:00:00Z"));
    const after = await computeLandingToken();
    expect(before).not.toBe(after);
  });
});
