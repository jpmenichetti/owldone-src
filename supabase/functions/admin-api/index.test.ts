import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  getSummary,
  getDaily,
  refresh,
  grantFeature,
  revokeFeature,
  listUserFeatures,
  getLandingStats,
  listLandingVisits,
} from "./index.ts";

// ---------- chainable mock builder ----------

type Call = {
  table?: string;
  rpc?: string;
  op: string;
  args: any[];
  filters: { method: string; args: any[] }[];
  options?: any;
};

function buildMockDb(
  resultsByTable: Record<string, (c: Call) => { data?: any; error?: any; count?: number }>,
  rpcResults: Record<string, (args: any) => { data?: any; error?: any }> = {},
  callLog: Call[] = [],
) {
  function chain(table: string, op: string, args: any[], options?: any) {
    const c: Call = { table, op, args, filters: [], options };
    callLog.push(c);
    const resolve = () => {
      const r = resultsByTable[table]?.(c) ?? { data: null, error: null };
      return Promise.resolve(r);
    };
    const proxy: any = {
      eq(...a: any[]) {
        c.filters.push({ method: "eq", args: a });
        return proxy;
      },
      gte(...a: any[]) {
        c.filters.push({ method: "gte", args: a });
        return proxy;
      },
      lte(...a: any[]) {
        c.filters.push({ method: "lte", args: a });
        return proxy;
      },
      order(...a: any[]) {
        c.filters.push({ method: "order", args: a });
        return proxy;
      },
      range(...a: any[]) {
        c.filters.push({ method: "range", args: a });
        return proxy;
      },
      select(...a: any[]) {
        c.filters.push({ method: "select", args: a });
        return proxy;
      },
      single() {
        c.filters.push({ method: "single", args: [] });
        return resolve();
      },
      maybeSingle() {
        c.filters.push({ method: "maybeSingle", args: [] });
        return resolve();
      },
      then(onF: any, onR: any) {
        return resolve().then(onF, onR);
      },
    };
    return proxy;
  }
  return {
    _calls: callLog,
    from(table: string) {
      return {
        select(cols: string, options?: any) {
          return chain(table, "select", [cols], options);
        },
        insert(values: any) {
          return chain(table, "insert", [values]);
        },
        update(values: any) {
          return chain(table, "update", [values]);
        },
        upsert(values: any, options?: any) {
          return chain(table, "upsert", [values], options);
        },
        delete() {
          return chain(table, "delete", []);
        },
      };
    },
    rpc(name: string, args: any) {
      const c: Call = { rpc: name, op: "rpc", args: [args], filters: [] };
      callLog.push(c);
      const r = rpcResults[name]?.(args) ?? { data: null, error: null };
      return Promise.resolve(r);
    },
  };
}

// Deterministic-ish UUID generator for tests so handlers that validate
// uuid-shaped inputs (e.g. user_id) don't reject hardcoded placeholders.
function mockUuid(seed?: string): string {
  const u = (globalThis.crypto?.randomUUID?.() ??
    "00000000-0000-4000-8000-000000000000");
  if (!seed) return u;
  // Stable per-seed: hash seed into last segment for readability in failures.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const tail = h.toString(16).padStart(12, "0").slice(-12);
  return `${u.slice(0, 24)}${tail}`;
}

const ADMIN_USER_ID = mockUuid("admin");
const TARGET_USER_ID = mockUuid("u1");

async function readJson(res: Response) {
  return JSON.parse(await res.text());
}

// ---------- getSummary / getDaily / refresh ----------

Deno.test("getSummary returns row with id=1", async () => {
  const db = buildMockDb({
    admin_stats_summary: () => ({ data: { id: 1, total_users: 5 }, error: null }),
  });
  const res = await getSummary({ db: db as any, userId: "admin", params: {} });
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).total_users, 5);
});

Deno.test("getSummary surfaces DB error", async () => {
  const db = buildMockDb({
    admin_stats_summary: () => ({ data: null, error: new Error("nope") }),
  });
  let threw = false;
  try {
    await getSummary({ db: db as any, userId: "admin", params: {} });
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("getDaily orders by stat_date asc", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ admin_stats_daily: () => ({ data: [{ d: 1 }], error: null }) }, {}, calls);
  await getDaily({ db: db as any, userId: "admin", params: {} });
  const sel = calls.find((c) => c.table === "admin_stats_daily")!;
  const order = sel.filters.find((f) => f.method === "order");
  assertEquals(order?.args[0], "stat_date");
  assertEquals(order?.args[1]?.ascending, true);
});

Deno.test("refresh calls compute_admin_stats RPC", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({}, { compute_admin_stats: () => ({ error: null }) }, calls);
  const res = await refresh({ db: db as any, userId: "admin", params: {} });
  assertEquals(res.status, 200);
  assert(calls.some((c) => c.rpc === "compute_admin_stats"));
});

// ---------- features ----------

Deno.test("grantFeature upserts with onConflict user_id,feature", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_features: () => ({ error: null }) }, {}, calls);
  await grantFeature({
    db: db as any,
    userId: "admin",
    params: { user_id: "u1", feature: "beta", expires_at: "2099-01-01" },
  });
  const c = calls.find((c) => c.table === "user_features" && c.op === "upsert")!;
  assertEquals(c.args[0], { user_id: "u1", feature: "beta", enabled: true, expires_at: "2099-01-01" });
  assertEquals(c.options?.onConflict, "user_id,feature");
});

Deno.test("grantFeature normalises empty expires_at to null", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_features: () => ({ error: null }) }, {}, calls);
  await grantFeature({
    db: db as any,
    userId: "admin",
    params: { user_id: "u1", feature: "beta", expires_at: "" },
  });
  const c = calls.find((c) => c.table === "user_features")!;
  assertEquals(c.args[0].expires_at, null);
});

Deno.test("revokeFeature deletes by user_id+feature", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_features: () => ({ error: null }) }, {}, calls);
  await revokeFeature({
    db: db as any,
    userId: "admin",
    params: { user_id: "u1", feature: "beta" },
  });
  const c = calls.find((c) => c.table === "user_features" && c.op === "delete")!;
  const eqs = c.filters.filter((f) => f.method === "eq");
  assertEquals(eqs.length, 2);
  assert(eqs.some((f) => f.args[0] === "user_id" && f.args[1] === "u1"));
  assert(eqs.some((f) => f.args[0] === "feature" && f.args[1] === "beta"));
});

Deno.test("listUserFeatures filters by user_id and returns rows", async () => {
  const db = buildMockDb({
    user_features: () => ({ data: [{ feature: "beta" }], error: null }),
  });
  const res = await listUserFeatures({
    db: db as any,
    userId: "admin",
    params: { user_id: "u1" },
  });
  const body = await readJson(res);
  assertEquals(body, [{ feature: "beta" }]);
});

Deno.test("listUserFeatures returns [] when DB returns null", async () => {
  const db = buildMockDb({ user_features: () => ({ data: null, error: null }) });
  const res = await listUserFeatures({
    db: db as any,
    userId: "admin",
    params: { user_id: "u1" },
  });
  assertEquals(await readJson(res), []);
});

// ---------- landing stats ----------

Deno.test("getLandingStats calls RPC with date range", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({}, {
    get_landing_visit_stats: (a) => ({ data: [{ source: "google_ads", visit_count: 3 }], error: null }),
  }, calls);
  const res = await getLandingStats({
    db: db as any,
    userId: "admin",
    params: { date_from: "2026-01-01", date_to: "2026-02-01" },
  });
  assertEquals(res.status, 200);
  const c = calls.find((c) => c.rpc === "get_landing_visit_stats")!;
  assertEquals(c.args[0], { p_date_from: "2026-01-01", p_date_to: "2026-02-01" });
});

Deno.test("listLandingVisits paginates and filters by source", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { landing_visits: () => ({ data: [{ id: "v1" }], error: null, count: 1 }) },
    {},
    calls,
  );
  const res = await listLandingVisits({
    db: db as any,
    userId: "admin",
    params: {
      date_from: "2026-01-01",
      date_to: "2026-02-01",
      source: "google_ads",
      limit: 25,
      offset: 50,
    },
  });
  const body = await readJson(res);
  assertEquals(body.total, 1);

  const c = calls.find((c) => c.table === "landing_visits")!;
  const range = c.filters.find((f) => f.method === "range");
  assertEquals(range?.args, [50, 74]);
  assert(c.filters.some((f) => f.method === "eq" && f.args[0] === "source" && f.args[1] === "google_ads"));
});

Deno.test("listLandingVisits skips source filter when 'all'", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { landing_visits: () => ({ data: [], error: null, count: 0 }) },
    {},
    calls,
  );
  await listLandingVisits({
    db: db as any,
    userId: "admin",
    params: { date_from: "a", date_to: "b", source: "all" },
  });
  const c = calls.find((c) => c.table === "landing_visits")!;
  assert(!c.filters.some((f) => f.method === "eq" && f.args[0] === "source"));
});
