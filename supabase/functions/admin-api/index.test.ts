import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  getSummary,
  getDaily,
  refresh,
  getLatencyStats,
  getLatencyTimeseries,
  purgeLatencyLogs,
  grantFeature,
  revokeFeature,
  listUserFeatures,
} from "./index.ts";

const USER_ID = "admin-user";

type Call = {
  table?: string;
  rpc?: string;
  op: string;
  args: any[];
  filters: Array<{ method: string; args: any[] }>;
  options?: any;
};

function buildMockDb(
  resultsByTable: Record<string, (call: Call) => { data?: any; error?: any }>,
  resultsByRpc: Record<string, (call: Call) => { data?: any; error?: any }>,
  callLog: Call[],
) {
  function makeChain(table: string, op: string, args: any[], options?: any) {
    const call: Call = { table, op, args, filters: [], options };
    callLog.push(call);

    const resolver = () => {
      const handler = resultsByTable[table];
      const res = handler ? handler(call) : { data: null, error: null };
      return Promise.resolve(res);
    };

    const chain: any = {
      eq(...a: any[]) { call.filters.push({ method: "eq", args: a }); return chain; },
      order(...a: any[]) { call.filters.push({ method: "order", args: a }); return chain; },
      select(...a: any[]) { call.filters.push({ method: "select", args: a }); return chain; },
      single() { call.filters.push({ method: "single", args: [] }); return resolver(); },
      maybeSingle() { call.filters.push({ method: "maybeSingle", args: [] }); return resolver(); },
      then(onFulfilled: any, onRejected: any) {
        return resolver().then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  return {
    from(table: string) {
      return {
        select: (cols: string, options?: any) => makeChain(table, "select", [cols], options),
        insert: (values: any) => makeChain(table, "insert", [values]),
        upsert: (values: any, options?: any) => makeChain(table, "upsert", [values], options),
        update: (values: any) => makeChain(table, "update", [values]),
        delete: () => makeChain(table, "delete", []),
      };
    },
    rpc(name: string, params?: any) {
      const call: Call = { rpc: name, op: "rpc", args: [params], filters: [] };
      callLog.push(call);
      const handler = resultsByRpc[name];
      const res = handler ? handler(call) : { data: null, error: null };
      return Promise.resolve(res);
    },
  };
}

async function readJson(res: Response) {
  return JSON.parse(await res.text());
}

// ---------- Tests ----------

Deno.test("getSummary fetches singleton row id=1", async () => {
  const calls: Call[] = [];
  const summary = { id: 1, total_users: 5, total_todos: 9 };
  const db = buildMockDb(
    { admin_stats_summary: () => ({ data: summary, error: null }) },
    {},
    calls,
  );

  const res = await getSummary({ db: db as any, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(res.status, 200);
  assertEquals(body, summary);
  const call = calls.find((c) => c.table === "admin_stats_summary")!;
  assertEquals(call.filters.find((f) => f.method === "eq")?.args, ["id", 1]);
  assertEquals(call.filters.find((f) => f.method === "single")?.args, []);
});

Deno.test("getSummary propagates DB errors", async () => {
  const db = buildMockDb(
    { admin_stats_summary: () => ({ data: null, error: { message: "fail" } }) },
    {},
    [],
  );

  let caught: any = null;
  try {
    await getSummary({ db: db as any, userId: USER_ID, params: {} });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught?.message, "fail");
});

Deno.test("getDaily orders by stat_date ascending", async () => {
  const calls: Call[] = [];
  const rows = [{ stat_date: "2024-01-01" }];
  const db = buildMockDb(
    { admin_stats_daily: () => ({ data: rows, error: null }) },
    {},
    calls,
  );

  const res = await getDaily({ db: db as any, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, rows);
  const call = calls.find((c) => c.table === "admin_stats_daily")!;
  assertEquals(call.filters.find((f) => f.method === "order")?.args, [
    "stat_date",
    { ascending: true },
  ]);
});

Deno.test("refresh calls compute_admin_stats RPC", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({}, { compute_admin_stats: () => ({ error: null }) }, calls);

  const res = await refresh({ db: db as any, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  assertEquals(calls.find((c) => c.rpc === "compute_admin_stats")?.op, "rpc");
});

Deno.test("refresh propagates RPC errors", async () => {
  const db = buildMockDb({}, { compute_admin_stats: () => ({ error: { message: "rpc-bad" } }) }, []);
  let caught: any = null;
  try {
    await refresh({ db: db as any, userId: USER_ID, params: {} });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught?.message, "rpc-bad");
});

Deno.test("getLatencyStats forwards date params to RPC", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {},
    { get_latency_stats: () => ({ data: [{ avg_ms: 12 }], error: null }) },
    calls,
  );

  const res = await getLatencyStats({
    db: db as any,
    userId: USER_ID,
    params: { date_from: "2024-01-01", date_to: "2024-01-31" },
  });
  const body = await readJson(res);

  assertEquals(body, [{ avg_ms: 12 }]);
  const call = calls.find((c) => c.rpc === "get_latency_stats")!;
  assertEquals(call.args[0], {
    p_date_from: "2024-01-01",
    p_date_to: "2024-01-31",
  });
});

Deno.test("getLatencyTimeseries defaults granularity to daily", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {},
    { get_latency_timeseries: () => ({ data: [], error: null }) },
    calls,
  );

  await getLatencyTimeseries({
    db: db as any,
    userId: USER_ID,
    params: { date_from: "a", date_to: "b" },
  });

  const call = calls.find((c) => c.rpc === "get_latency_timeseries")!;
  assertEquals(call.args[0], {
    p_date_from: "a",
    p_date_to: "b",
    p_granularity: "daily",
  });
});

Deno.test("getLatencyTimeseries forwards explicit granularity", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {},
    { get_latency_timeseries: () => ({ data: [], error: null }) },
    calls,
  );

  await getLatencyTimeseries({
    db: db as any,
    userId: USER_ID,
    params: { date_from: "a", date_to: "b", granularity: "hourly" },
  });

  const call = calls.find((c) => c.rpc === "get_latency_timeseries")!;
  assertEquals(call.args[0].p_granularity, "hourly");
});

Deno.test("purgeLatencyLogs calls purge_old_latency_logs RPC", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({}, { purge_old_latency_logs: () => ({ error: null }) }, calls);

  const res = await purgeLatencyLogs({ db: db as any, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  assertEquals(calls.find((c) => c.rpc === "purge_old_latency_logs")?.op, "rpc");
});

Deno.test("grantFeature upserts row with onConflict and expires_at", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_features: () => ({ error: null }) }, {}, calls);

  const expires = "2030-01-01T00:00:00Z";
  const res = await grantFeature({
    db: db as any,
    userId: USER_ID,
    params: { user_id: "target-1", feature: "beta", expires_at: expires },
  });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const call = calls.find((c) => c.op === "upsert")!;
  assertEquals(call.args[0], {
    user_id: "target-1",
    feature: "beta",
    enabled: true,
    expires_at: expires,
  });
  assertEquals(call.options, { onConflict: "user_id,feature" });
});

Deno.test("grantFeature defaults expires_at to null when omitted", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_features: () => ({ error: null }) }, {}, calls);

  await grantFeature({
    db: db as any,
    userId: USER_ID,
    params: { user_id: "target-2", feature: "recurrence" },
  });

  const call = calls.find((c) => c.op === "upsert")!;
  assertEquals(call.args[0].expires_at, null);
});

Deno.test("revokeFeature deletes by user_id and feature", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_features: () => ({ error: null }) }, {}, calls);

  const res = await revokeFeature({
    db: db as any,
    userId: USER_ID,
    params: { user_id: "target-3", feature: "beta" },
  });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const call = calls.find((c) => c.op === "delete")!;
  const eqs = call.filters.filter((f) => f.method === "eq").map((f) => f.args);
  assertEquals(eqs, [["user_id", "target-3"], ["feature", "beta"]]);
});

Deno.test("revokeFeature propagates DB errors", async () => {
  const db = buildMockDb(
    { user_features: () => ({ error: { message: "del-fail" } }) },
    {},
    [],
  );

  let caught: any = null;
  try {
    await revokeFeature({
      db: db as any,
      userId: USER_ID,
      params: { user_id: "x", feature: "y" },
    });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught?.message, "del-fail");
});

Deno.test("listUserFeatures returns rows for target user", async () => {
  const calls: Call[] = [];
  const rows = [{ feature: "beta", enabled: true }];
  const db = buildMockDb(
    { user_features: () => ({ data: rows, error: null }) },
    {},
    calls,
  );

  const res = await listUserFeatures({
    db: db as any,
    userId: USER_ID,
    params: { user_id: "target-4" },
  });
  const body = await readJson(res);

  assertEquals(body, rows);
  const call = calls.find((c) => c.table === "user_features")!;
  assertEquals(call.filters.find((f) => f.method === "eq")?.args, ["user_id", "target-4"]);
});

Deno.test("listUserFeatures returns [] when no rows", async () => {
  const db = buildMockDb(
    { user_features: () => ({ data: null, error: null }) },
    {},
    [],
  );

  const res = await listUserFeatures({
    db: db as any,
    userId: USER_ID,
    params: { user_id: "target-5" },
  });
  const body = await readJson(res);

  assertEquals(body, []);
});
