import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

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

const USER_ID = "user-abc";

type Call = {
  table: string;
  op: string;
  args: any[];
  filters: { method: string; args: any[] }[];
  options?: any;
};

function buildMockDb(
  resultsByTable: Record<string, (c: Call) => { data?: any; error?: any }>,
  callLog: Call[] = [],
) {
  // Auto-stub `workspaces` so ensureDefaultWorkspace() (called by virtually
  // every handler) doesn't crash. Tests can override by passing their own.
  const DEFAULT_WORKSPACE_ID = "ws-default";
  if (!resultsByTable.workspaces) {
    resultsByTable.workspaces = (c: Call) => {
      const terminator = c.filters.find(
        (f) => f.method === "single" || f.method === "maybeSingle",
      );
      if (terminator) {
        return { data: { id: DEFAULT_WORKSPACE_ID, is_default: true }, error: null };
      }
      // Awaited select listing workspaces for the user.
      return {
        data: [{ id: DEFAULT_WORKSPACE_ID, is_default: true, position: 0 }],
        error: null,
      };
    };
  }

  function chain(table: string, op: string, args: any[], options?: any) {
    const c: Call = { table, op, args, filters: [], options };
    callLog.push(c);
    const resolve = () => Promise.resolve(resultsByTable[table]?.(c) ?? { data: null, error: null });
    const proxy: any = {
      eq(...a: any[]) {
        c.filters.push({ method: "eq", args: a });
        return proxy;
      },
      in(...a: any[]) {
        c.filters.push({ method: "in", args: a });
        return proxy;
      },
      order(...a: any[]) {
        c.filters.push({ method: "order", args: a });
        return proxy;
      },
      limit(...a: any[]) {
        c.filters.push({ method: "limit", args: a });
        return resolve();
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
        select(cols: string) {
          return chain(table, "select", [cols]);
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
      };
    },
  };
}


async function readJson(res: Response) {
  return JSON.parse(await res.text());
}

// ---------- getFilters ----------

Deno.test("getFilters returns row scoped to userId", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({
    user_filters: () => ({ data: { show_overdue: true, selected_tags: ["x"] }, error: null }),
  }, calls);
  const res = await getFilters({ db: db as any, userId: USER_ID, params: {} });
  const body = await readJson(res);
  assertEquals(body, { show_overdue: true, selected_tags: ["x"] });
  const c = calls.find((c) => c.table === "user_filters")!;
  assert(c.filters.some((f) => f.method === "eq" && f.args[0] === "user_id" && f.args[1] === USER_ID));
});

Deno.test("getFilters defaults when no row exists", async () => {
  const db = buildMockDb({ user_filters: () => ({ data: null, error: null }) });
  const res = await getFilters({ db: db as any, userId: USER_ID, params: {} });
  assertEquals(await readJson(res), {
    show_overdue: false,
    selected_tags: [],
    workspace_id: "ws-default",
  });

});

Deno.test("upsertFilters forces user_id from auth context (ignores body user_id)", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_filters: () => ({ error: null }) }, calls);
  await upsertFilters({
    db: db as any,
    userId: USER_ID,
    params: { user_id: "OTHER", show_overdue: true, selected_tags: ["a"] },
  });
  const c = calls.find((c) => c.table === "user_filters" && c.op === "upsert")!;
  assertEquals(c.args[0].user_id, USER_ID);
  // workspace_id is injected from the auth-scoped default; body value cannot override it.
  assertEquals(c.args[0].workspace_id, "ws-default");
  assertEquals(c.options?.onConflict, "user_id,workspace_id");

});

// ---------- onboarding ----------

Deno.test("getOnboarding: showOnboarding=true when no row", async () => {
  const db = buildMockDb({ user_preferences: () => ({ data: null, error: null }) });
  const res = await getOnboarding({ db: db as any, userId: USER_ID, params: {} });
  assertEquals(await readJson(res), { showOnboarding: true });
});

Deno.test("getOnboarding: showOnboarding=true when not completed", async () => {
  const db = buildMockDb({
    user_preferences: () => ({ data: { onboarding_completed: false }, error: null }),
  });
  const res = await getOnboarding({ db: db as any, userId: USER_ID, params: {} });
  assertEquals(await readJson(res), { showOnboarding: true });
});

Deno.test("getOnboarding: showOnboarding=false when completed", async () => {
  const db = buildMockDb({
    user_preferences: () => ({ data: { onboarding_completed: true }, error: null }),
  });
  const res = await getOnboarding({ db: db as any, userId: USER_ID, params: {} });
  assertEquals(await readJson(res), { showOnboarding: false });
});

Deno.test("completeOnboarding upserts onboarding_completed=true", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_preferences: () => ({ error: null }) }, calls);
  await completeOnboarding({ db: db as any, userId: USER_ID, params: {} });
  const c = calls.find((c) => c.table === "user_preferences")!;
  assertEquals(c.args[0], { user_id: USER_ID, onboarding_completed: true });
});

// ---------- admin check ----------

Deno.test("checkAdmin: isAdmin=true when row present", async () => {
  const db = buildMockDb({ user_roles: () => ({ data: { role: "admin" }, error: null }) });
  const res = await checkAdmin({ db: db as any, userId: USER_ID, params: {} });
  assertEquals(await readJson(res), { isAdmin: true });
});

Deno.test("checkAdmin: isAdmin=false when no row", async () => {
  const db = buildMockDb({ user_roles: () => ({ data: null, error: null }) });
  const res = await checkAdmin({ db: db as any, userId: USER_ID, params: {} });
  assertEquals(await readJson(res), { isAdmin: false });
});

Deno.test("checkAdmin: queries with role='admin' (cannot escalate via role injection)", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_roles: () => ({ data: null, error: null }) }, calls);
  await checkAdmin({
    db: db as any,
    userId: USER_ID,
    params: { role: "moderator" }, // attempt to override
  });
  const c = calls.find((c) => c.table === "user_roles")!;
  // both eqs hardcoded
  assert(c.filters.some((f) => f.method === "eq" && f.args[0] === "user_id" && f.args[1] === USER_ID));
  assert(c.filters.some((f) => f.method === "eq" && f.args[0] === "role" && f.args[1] === "admin"));
});

// ---------- weekly reports ----------

Deno.test("getWeeklyReports: scoped to userId, ordered desc, limit 12", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { weekly_reports: () => ({ data: [{ id: "r1" }], error: null }) },
    calls,
  );
  await getWeeklyReports({ db: db as any, userId: USER_ID, params: {} });
  const c = calls.find((c) => c.table === "weekly_reports")!;
  assert(c.filters.some((f) => f.method === "eq" && f.args[0] === "user_id" && f.args[1] === USER_ID));
  const order = c.filters.find((f) => f.method === "order");
  assertEquals(order?.args[0], "week_start");
  assertEquals(order?.args[1]?.ascending, false);
  const limit = c.filters.find((f) => f.method === "limit");
  assertEquals(limit?.args[0], 12);
});

Deno.test("getWeeklyReports: returns [] when DB returns null", async () => {
  const db = buildMockDb({ weekly_reports: () => ({ data: null, error: null }) });
  const res = await getWeeklyReports({ db: db as any, userId: USER_ID, params: {} });
  assertEquals(await readJson(res), []);
});

// ---------- language ----------

Deno.test("getLanguage: defaults to 'en' when no row", async () => {
  const db = buildMockDb({ user_preferences: () => ({ data: null, error: null }) });
  const res = await getLanguage({ db: db as any, userId: USER_ID, params: {} });
  assertEquals(await readJson(res), { language: "en" });
});

Deno.test("getLanguage: returns stored language", async () => {
  const db = buildMockDb({
    user_preferences: () => ({ data: { language: "es" }, error: null }),
  });
  const res = await getLanguage({ db: db as any, userId: USER_ID, params: {} });
  assertEquals(await readJson(res), { language: "es" });
});

Deno.test("setLanguage: upserts with user_id from auth (ignores body user_id)", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ user_preferences: () => ({ error: null }) }, calls);
  await setLanguage({
    db: db as any,
    userId: USER_ID,
    params: { user_id: "OTHER", language: "fr" },
  });
  const c = calls.find((c) => c.table === "user_preferences")!;
  assertEquals(c.args[0], { user_id: USER_ID, language: "fr" });
});

// ---------- features ----------

Deno.test("getFeatures: filters out expired and disabled", async () => {
  const past = "2000-01-01T00:00:00Z";
  const future = "2999-01-01T00:00:00Z";
  const db = buildMockDb({
    user_features: () => ({
      data: [
        { feature: "active-no-exp", enabled: true, expires_at: null },
        { feature: "active-future", enabled: true, expires_at: future },
        { feature: "expired", enabled: true, expires_at: past },
      ],
      error: null,
    }),
  });
  const res = await getFeatures({ db: db as any, userId: USER_ID, params: {} });
  const body = await readJson(res);
  assertEquals(body.features.sort(), ["active-future", "active-no-exp"]);
});

Deno.test("getFeatures: returns {features:[]} when DB returns null", async () => {
  const db = buildMockDb({ user_features: () => ({ data: null, error: null }) });
  const res = await getFeatures({ db: db as any, userId: USER_ID, params: {} });
  assertEquals(await readJson(res), { features: [] });
});
