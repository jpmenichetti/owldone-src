import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  getFilters,
  upsertFilters,
  getOnboarding,
  completeOnboarding,
  checkAdmin,
  getWeeklyReports,
  getLanguage,
  setLanguage,
  getFeatures,
} from "./index.ts";

// ---------- Test setup helpers ----------

const USER_ID = "user-123";

type Call = {
  table: string;
  op: string;
  args: any[];
  filters: Array<{ method: string; args: any[] }>;
  options?: any;
};

/**
 * Chainable in-memory mock of the Supabase query builder.
 * Supports: select, insert, upsert, update, delete + filters
 *           eq, in, order, range, limit, select-on-chain
 *           terminators: maybeSingle(), single(), then() (await chain).
 */
function buildMockDb(
  resultsByTable: Record<
    string,
    (call: Call) => { data?: any; error?: any; count?: number }
  >,
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
      eq(...a: any[]) {
        call.filters.push({ method: "eq", args: a });
        return chain;
      },
      in(...a: any[]) {
        call.filters.push({ method: "in", args: a });
        return chain;
      },
      order(...a: any[]) {
        call.filters.push({ method: "order", args: a });
        return chain;
      },
      range(...a: any[]) {
        call.filters.push({ method: "range", args: a });
        return chain;
      },
      limit(...a: any[]) {
        call.filters.push({ method: "limit", args: a });
        return chain;
      },
      select(...a: any[]) {
        call.filters.push({ method: "select", args: a });
        return chain;
      },
      single() {
        call.filters.push({ method: "single", args: [] });
        return resolver();
      },
      maybeSingle() {
        call.filters.push({ method: "maybeSingle", args: [] });
        return resolver();
      },
      then(onFulfilled: any, onRejected: any) {
        return resolver().then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  return {
    from(table: string) {
      return {
        select(cols: string, options?: any) {
          return makeChain(table, "select", [cols], options);
        },
        insert(values: any) {
          return makeChain(table, "insert", [values]);
        },
        upsert(values: any, options?: any) {
          return makeChain(table, "upsert", [values], options);
        },
        update(values: any) {
          return makeChain(table, "update", [values]);
        },
        delete() {
          return makeChain(table, "delete", []);
        },
      };
    },
  };
}

async function readJson(res: Response) {
  return JSON.parse(await res.text());
}

// ---------- Tests ----------

Deno.test("getFilters returns existing row", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {
      user_filters: () => ({
        data: { show_overdue: true, selected_tags: ["a"] },
        error: null,
      }),
    },
    calls,
  );

  const res = await getFilters({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(res.status, 200);
  assertEquals(body, { show_overdue: true, selected_tags: ["a"] });
  const call = calls.find((c) => c.table === "user_filters")!;
  assertEquals(call.filters.find((f) => f.method === "eq")?.args, ["user_id", USER_ID]);
});

Deno.test("getFilters returns defaults when no row exists", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { user_filters: () => ({ data: null, error: null }) },
    calls,
  );

  const res = await getFilters({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { show_overdue: false, selected_tags: [] });
});

Deno.test("upsertFilters writes user_id with onConflict", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_filters: () => ({ error: null }) }, calls);

  const res = await upsertFilters({
    db,
    userId: USER_ID,
    params: { show_overdue: true, selected_tags: ["x"] },
  });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const call = calls.find((c) => c.op === "upsert")!;
  assertEquals(call.args[0], {
    user_id: USER_ID,
    show_overdue: true,
    selected_tags: ["x"],
  });
  assertEquals(call.options, { onConflict: "user_id" });
});

Deno.test("getOnboarding returns showOnboarding=true when no preferences row", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { user_preferences: () => ({ data: null, error: null }) },
    calls,
  );

  const res = await getOnboarding({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { showOnboarding: true });
});

Deno.test("getOnboarding returns showOnboarding=false when completed", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {
      user_preferences: () => ({
        data: { onboarding_completed: true },
        error: null,
      }),
    },
    calls,
  );

  const res = await getOnboarding({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { showOnboarding: false });
});

Deno.test("getOnboarding returns showOnboarding=true when row exists but not completed", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {
      user_preferences: () => ({
        data: { onboarding_completed: false },
        error: null,
      }),
    },
    calls,
  );

  const res = await getOnboarding({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { showOnboarding: true });
});

Deno.test("completeOnboarding upserts onboarding_completed=true", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_preferences: () => ({ error: null }) }, calls);

  const res = await completeOnboarding({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const call = calls.find((c) => c.op === "upsert")!;
  assertEquals(call.args[0], { user_id: USER_ID, onboarding_completed: true });
  assertEquals(call.options, { onConflict: "user_id" });
});

Deno.test("checkAdmin returns isAdmin=true when row exists", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { user_roles: () => ({ data: { role: "admin" }, error: null }) },
    calls,
  );

  const res = await checkAdmin({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { isAdmin: true });
  const call = calls.find((c) => c.table === "user_roles")!;
  const eqs = call.filters.filter((f) => f.method === "eq").map((f) => f.args);
  assertEquals(eqs, [["user_id", USER_ID], ["role", "admin"]]);
});

Deno.test("checkAdmin returns isAdmin=false when no row", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { user_roles: () => ({ data: null, error: null }) },
    calls,
  );

  const res = await checkAdmin({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { isAdmin: false });
});

Deno.test("getWeeklyReports returns rows ordered and limited to 12", async () => {
  const calls: Call[] = [];
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` }));
  const db = buildMockDb(
    { weekly_reports: () => ({ data: rows, error: null }) },
    calls,
  );

  const res = await getWeeklyReports({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, rows);
  const call = calls.find((c) => c.table === "weekly_reports")!;
  assertEquals(call.filters.find((f) => f.method === "order")?.args, [
    "week_start",
    { ascending: false },
  ]);
  assertEquals(call.filters.find((f) => f.method === "limit")?.args, [12]);
});

Deno.test("getWeeklyReports returns empty array when no rows", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { weekly_reports: () => ({ data: null, error: null }) },
    calls,
  );

  const res = await getWeeklyReports({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, []);
});

Deno.test("getLanguage returns stored language", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { user_preferences: () => ({ data: { language: "es" }, error: null }) },
    calls,
  );

  const res = await getLanguage({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { language: "es" });
});

Deno.test("getLanguage falls back to 'en' when no row", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { user_preferences: () => ({ data: null, error: null }) },
    calls,
  );

  const res = await getLanguage({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { language: "en" });
});

Deno.test("setLanguage upserts language with onConflict", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_preferences: () => ({ error: null }) }, calls);

  const res = await setLanguage({
    db,
    userId: USER_ID,
    params: { language: "fr" },
  });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const call = calls.find((c) => c.op === "upsert")!;
  assertEquals(call.args[0], { user_id: USER_ID, language: "fr" });
  assertEquals(call.options, { onConflict: "user_id" });
});

Deno.test("getFeatures returns only enabled, non-expired feature names", async () => {
  const calls: Call[] = [];
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const db = buildMockDb(
    {
      user_features: () => ({
        data: [
          { feature: "recurrence", enabled: true, expires_at: null },
          { feature: "beta-x", enabled: true, expires_at: future },
          { feature: "expired-y", enabled: true, expires_at: past },
        ],
        error: null,
      }),
    },
    calls,
  );

  const res = await getFeatures({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { features: ["recurrence", "beta-x"] });
  const call = calls.find((c) => c.table === "user_features")!;
  const eqs = call.filters.filter((f) => f.method === "eq").map((f) => f.args);
  assertEquals(eqs, [["user_id", USER_ID], ["enabled", true]]);
});

Deno.test("getFeatures returns empty array when no rows", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { user_features: () => ({ data: null, error: null }) },
    calls,
  );

  const res = await getFeatures({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { features: [] });
});

Deno.test("getFilters propagates DB errors", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { user_filters: () => ({ data: null, error: { message: "boom" } }) },
    calls,
  );

  let caught: any = null;
  try {
    await getFilters({ db, userId: USER_ID, params: {} });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught?.message, "boom");
});

Deno.test("setLanguage propagates DB errors", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { user_preferences: () => ({ error: { message: "nope" } }) },
    calls,
  );

  let caught: any = null;
  try {
    await setLanguage({ db, userId: USER_ID, params: { language: "de" } });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught?.message, "nope");
});

Deno.test("checkAdmin does not throw when DB returns no data", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_roles: () => ({ data: null }) }, calls);

  const res = await checkAdmin({ db, userId: USER_ID, params: {} });
  assert(res.ok);
});
