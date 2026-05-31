import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  BodySchema,
  expectedToken,
  handleRequest,
  rateLimited,
  RATE_LIMIT,
  _resetRateLimit,
  _setClientFactory,
} from "./index.ts";

// ---------- helpers ----------

type InsertCall = { table: string; row: any };

function buildServiceMock(insertResult: { error: any } = { error: null }) {
  const calls: InsertCall[] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: any) {
          calls.push({ table, row });
          return Promise.resolve(insertResult);
        },
      };
    },
    auth: {
      // Default: unauthenticated user (no claims)
      getClaims: async (_token: string) => ({ data: null, error: null }),
    },
  };
  return { client, calls };
}

async function buildPostRequest(
  body: unknown,
  opts: { token?: string; ip?: string; auth?: string; ua?: string } = {},
): Promise<Request> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-landing-token": opts.token ?? (await expectedToken()),
    "x-forwarded-for": opts.ip ?? "1.2.3.4",
  };
  if (opts.auth) headers["Authorization"] = opts.auth;
  if (opts.ua) headers["user-agent"] = opts.ua;
  return new Request("http://x/log-landing-visit", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    source: "google_ads" as const,
    landing_path: "/",
    gclid: "abc",
    utm_source: "google",
    utm_medium: "cpc",
  };
}

// ---------- BodySchema ----------

Deno.test("BodySchema rejects unknown source", () => {
  const r = BodySchema.safeParse({ source: "bing" });
  assert(!r.success);
});

Deno.test("BodySchema rejects landing_path over 2048 chars", () => {
  const r = BodySchema.safeParse({ source: "google_ads", landing_path: "x".repeat(2049) });
  assert(!r.success);
});

Deno.test("BodySchema defaults landing_path to '/'", () => {
  const r = BodySchema.safeParse({ source: "google_organic" });
  assert(r.success);
  if (r.success) assertEquals(r.data.landing_path, "/");
});

Deno.test("BodySchema rejects gclid over 512 chars", () => {
  const r = BodySchema.safeParse({ source: "google_ads", gclid: "g".repeat(513) });
  assert(!r.success);
});

Deno.test("BodySchema rejects referrer over 2048 chars", () => {
  const r = BodySchema.safeParse({ source: "google_ads", referrer: "r".repeat(2049) });
  assert(!r.success);
});

// ---------- expectedToken ----------

Deno.test("expectedToken returns 32-char lowercase hex", async () => {
  const t = await expectedToken();
  assert(/^[a-f0-9]{32}$/.test(t));
});

Deno.test("expectedToken is stable within a single day", async () => {
  const a = await expectedToken();
  const b = await expectedToken();
  assertEquals(a, b);
});

// ---------- rateLimited ----------

Deno.test("rateLimited allows first N requests then blocks", () => {
  _resetRateLimit();
  const ip = "test-ip-rl";
  for (let i = 0; i < RATE_LIMIT; i++) {
    assertEquals(rateLimited(ip), false, `request ${i + 1} should pass`);
  }
  assertEquals(rateLimited(ip), true, "request over limit should block");
});

Deno.test("rateLimited is per-IP", () => {
  _resetRateLimit();
  for (let i = 0; i < RATE_LIMIT; i++) rateLimited("ip-a");
  assertEquals(rateLimited("ip-a"), true);
  assertEquals(rateLimited("ip-b"), false);
});

// ---------- handleRequest ----------

Deno.test("handleRequest: OPTIONS returns CORS headers", async () => {
  _resetRateLimit();
  const res = await handleRequest(new Request("http://x", { method: "OPTIONS" }));
  await res.text();
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert(res.headers.get("Access-Control-Allow-Headers")?.includes("x-landing-token"));
});

Deno.test("handleRequest: non-POST rejected with 405", async () => {
  _resetRateLimit();
  const res = await handleRequest(new Request("http://x", { method: "GET" }));
  await res.text();
  assertEquals(res.status, 405);
});

Deno.test("handleRequest: missing token returns 403", async () => {
  _resetRateLimit();
  const req = await buildPostRequest(validBody(), { token: "" });
  const res = await handleRequest(req);
  await res.text();
  assertEquals(res.status, 403);
});

Deno.test("handleRequest: bad token returns 403", async () => {
  _resetRateLimit();
  const req = await buildPostRequest(validBody(), { token: "0".repeat(32) });
  const res = await handleRequest(req);
  await res.text();
  assertEquals(res.status, 403);
});

Deno.test("handleRequest: invalid body returns 400", async () => {
  _resetRateLimit();
  Deno.env.set("SUPABASE_URL", "http://stub");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub");
  Deno.env.set("SUPABASE_ANON_KEY", "stub");
  const req = await buildPostRequest({ source: "bing" });
  const res = await handleRequest(req);
  await res.text();
  assertEquals(res.status, 400);
});

Deno.test("handleRequest: valid body inserts visit and returns 200", async () => {
  _resetRateLimit();
  Deno.env.set("SUPABASE_URL", "http://stub");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub");
  Deno.env.set("SUPABASE_ANON_KEY", "stub");
  const { client, calls } = buildServiceMock();
  _setClientFactory(() => client);
  try {
    const req = await buildPostRequest(validBody(), { ua: "test-agent" });
    const res = await handleRequest(req);
    const body = JSON.parse(await res.text());
    assertEquals(res.status, 200);
    assertEquals(body, { ok: true });
    assertEquals(calls.length, 1);
    assertEquals(calls[0].table, "landing_visits");
    assertEquals(calls[0].row.source, "google_ads");
    assertEquals(calls[0].row.user_agent, "test-agent");
    assertEquals(calls[0].row.user_id, null);
  } finally {
    _setClientFactory(null);
  }
});

Deno.test("handleRequest: anonymous when Authorization header missing", async () => {
  _resetRateLimit();
  Deno.env.set("SUPABASE_URL", "http://stub");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub");
  Deno.env.set("SUPABASE_ANON_KEY", "stub");
  const { client, calls } = buildServiceMock();
  _setClientFactory(() => client);
  try {
    const req = await buildPostRequest(validBody());
    await handleRequest(req).then((r) => r.text());
    assertEquals(calls[0].row.user_id, null);
  } finally {
    _setClientFactory(null);
  }
});

Deno.test("handleRequest: captures user_id when JWT is valid", async () => {
  _resetRateLimit();
  Deno.env.set("SUPABASE_URL", "http://stub");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub");
  Deno.env.set("SUPABASE_ANON_KEY", "stub");
  const { client, calls } = buildServiceMock();
  // Override auth to return a sub claim
  (client as any).auth.getClaims = async () => ({
    data: { claims: { sub: "user-xyz" } },
    error: null,
  });
  _setClientFactory(() => client);
  try {
    const req = await buildPostRequest(validBody(), { auth: "Bearer fake-jwt" });
    await handleRequest(req).then((r) => r.text());
    assertEquals(calls[0].row.user_id, "user-xyz");
  } finally {
    _setClientFactory(null);
  }
});

Deno.test("handleRequest: silently treats JWT errors as anonymous", async () => {
  _resetRateLimit();
  Deno.env.set("SUPABASE_URL", "http://stub");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub");
  Deno.env.set("SUPABASE_ANON_KEY", "stub");
  const { client, calls } = buildServiceMock();
  (client as any).auth.getClaims = async () => {
    throw new Error("bad jwt");
  };
  _setClientFactory(() => client);
  try {
    const req = await buildPostRequest(validBody(), { auth: "Bearer bad" });
    const res = await handleRequest(req);
    await res.text();
    assertEquals(res.status, 200);
    assertEquals(calls[0].row.user_id, null);
  } finally {
    _setClientFactory(null);
  }
});

Deno.test("handleRequest: returns 500 when DB insert fails", async () => {
  _resetRateLimit();
  Deno.env.set("SUPABASE_URL", "http://stub");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub");
  Deno.env.set("SUPABASE_ANON_KEY", "stub");
  const { client } = buildServiceMock({ error: { message: "db boom" } });
  _setClientFactory(() => client);
  try {
    const req = await buildPostRequest(validBody());
    const res = await handleRequest(req);
    const body = JSON.parse(await res.text());
    assertEquals(res.status, 500);
    assertEquals(body, { error: "Internal server error" });
  } finally {
    _setClientFactory(null);
  }
});

Deno.test("handleRequest: enforces rate limit per IP and returns 429", async () => {
  _resetRateLimit();
  Deno.env.set("SUPABASE_URL", "http://stub");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub");
  Deno.env.set("SUPABASE_ANON_KEY", "stub");
  const { client } = buildServiceMock();
  _setClientFactory(() => client);
  try {
    // Burn through the budget for one IP.
    for (let i = 0; i < RATE_LIMIT; i++) {
      const r = await handleRequest(await buildPostRequest(validBody(), { ip: "9.9.9.9" }));
      await r.text();
    }
    const blocked = await handleRequest(await buildPostRequest(validBody(), { ip: "9.9.9.9" }));
    await blocked.text();
    assertEquals(blocked.status, 429);
  } finally {
    _setClientFactory(null);
  }
});

Deno.test("handleRequest: truncates oversized user-agent to 1024 chars", async () => {
  _resetRateLimit();
  Deno.env.set("SUPABASE_URL", "http://stub");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub");
  Deno.env.set("SUPABASE_ANON_KEY", "stub");
  const { client, calls } = buildServiceMock();
  _setClientFactory(() => client);
  try {
    const req = await buildPostRequest(validBody(), { ua: "z".repeat(5000) });
    await handleRequest(req).then((r) => r.text());
    assertEquals((calls[0].row.user_agent as string).length, 1024);
  } finally {
    _setClientFactory(null);
  }
});
