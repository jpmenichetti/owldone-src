import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  listTodos,
  listArchived,
  countArchived,
  addTodo,
  updateTodo,
  toggleComplete,
  removeTodo,
  restoreTodo,
  deletePermanent,
  deleteAll,
  bulkInsert,
  archiveCompleted,
  autoTransitions,
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
 * Builds a chainable mock query builder.
 * `tableResults` maps table name → result handler (returns the awaited result).
 * For `select` chains, the chain itself is awaitable (resolves to `{ data, error, count }`).
 * For `single()`, `range()`, etc. it also resolves.
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
      select(...a: any[]) {
        call.filters.push({ method: "select", args: a });
        return chain;
      },
      single() {
        call.filters.push({ method: "single", args: [] });
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

Deno.test("listTodos returns todos with attached images", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {
      todos: () => ({
        data: [
          { id: "t1", text: "A", user_id: USER_ID },
          { id: "t2", text: "B", user_id: USER_ID },
        ],
        error: null,
      }),
      todo_images: () => ({
        data: [{ id: "i1", todo_id: "t1", storage_path: "p" }],
        error: null,
      }),
    },
    calls,
  );

  const res = await listTodos({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(res.status, 200);
  assertEquals(body.length, 2);
  assertEquals(body[0].images.length, 1);
  assertEquals(body[1].images.length, 0);
  assert(calls.some((c) => c.table === "todos" && c.op === "select"));
  assert(calls.some((c) => c.table === "todo_images"));
});

Deno.test("listTodos skips image fetch when no todos", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { todos: () => ({ data: [], error: null }) },
    calls,
  );

  const res = await listTodos({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, []);
  assertEquals(calls.filter((c) => c.table === "todo_images").length, 0);
});

Deno.test("listArchived paginates without search", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { todos: () => ({ data: [{ id: "a1" }], error: null }) },
    calls,
  );

  const res = await listArchived({
    db,
    userId: USER_ID,
    params: { pageSize: 20, pageOffset: 0 },
  });
  const body = await readJson(res);

  assertEquals(body, [{ id: "a1" }]);
  const todoCall = calls.find((c) => c.table === "todos")!;
  const rangeFilter = todoCall.filters.find((f) => f.method === "range");
  assertEquals(rangeFilter?.args, [0, 19]);
});

Deno.test("listArchived filters and slices when searchText provided", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {
      todos: () => ({
        data: [
          { id: "1", text: "buy MILK", notes: "", urls: [] },
          { id: "2", text: "walk dog", notes: "milk run", urls: [] },
          { id: "3", text: "work", notes: "", urls: ["http://milk.com"] },
          { id: "4", text: "unrelated", notes: "", urls: [] },
        ],
        error: null,
      }),
    },
    calls,
  );

  const res = await listArchived({
    db,
    userId: USER_ID,
    params: { searchText: "milk", pageSize: 2, pageOffset: 0 },
  });
  const body = await readJson(res);

  assertEquals(body.length, 2);
  assertEquals(body.map((t: any) => t.id), ["1", "2"]);
});

Deno.test("countArchived returns DB count when no search", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { todos: () => ({ count: 42, error: null }) },
    calls,
  );

  const res = await countArchived({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { count: 42 });
});

Deno.test("countArchived counts matches when search provided", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    {
      todos: () => ({
        data: [
          { text: "Buy Milk", notes: "", urls: [] },
          { text: "milkshake", notes: "", urls: [] },
          { text: "other", notes: "", urls: [] },
        ],
        error: null,
      }),
    },
    calls,
  );

  const res = await countArchived({
    db,
    userId: USER_ID,
    params: { searchText: "MILK" },
  });
  const body = await readJson(res);

  assertEquals(body, { count: 2 });
});

Deno.test("addTodo inserts with user_id and returns id", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { todos: () => ({ data: { id: "new-id" }, error: null }) },
    calls,
  );

  const res = await addTodo({
    db,
    userId: USER_ID,
    params: { text: "hi", category: "today" },
  });
  const body = await readJson(res);

  assertEquals(body, { success: true, id: "new-id" });
  const insertCall = calls.find((c) => c.op === "insert")!;
  assertEquals(insertCall.args[0], { text: "hi", category: "today", user_id: USER_ID });
});

Deno.test("updateTodo strips action and id from payload", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const res = await updateTodo({
    db,
    userId: USER_ID,
    params: { id: "t1", action: "update", text: "new", notes: "n" },
  });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const updateCall = calls.find((c) => c.op === "update")!;
  assertEquals(updateCall.args[0], { text: "new", notes: "n" });
  assertEquals(
    updateCall.filters.filter((f) => f.method === "eq").map((f) => f.args),
    [["id", "t1"], ["user_id", USER_ID]],
  );
});

Deno.test("toggleComplete sets completed_at when completing", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const res = await toggleComplete({
    db,
    userId: USER_ID,
    params: { id: "t1", completed: true },
  });
  await readJson(res);

  const updateCall = calls.find((c) => c.op === "update")!;
  assertEquals(updateCall.args[0].completed, true);
  assert(typeof updateCall.args[0].completed_at === "string");
});

Deno.test("toggleComplete clears completed_at when uncompleting", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const res = await toggleComplete({
    db,
    userId: USER_ID,
    params: { id: "t1", completed: false },
  });
  await readJson(res);

  const updateCall = calls.find((c) => c.op === "update")!;
  assertEquals(updateCall.args[0], {
    completed: false,
    completed_at: null,
  });
});

Deno.test("removeTodo soft-deletes with timestamp", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const res = await removeTodo({ db, userId: USER_ID, params: { id: "t1" } });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const updateCall = calls.find((c) => c.op === "update")!;
  assertEquals(updateCall.args[0].removed, true);
  assert(typeof updateCall.args[0].removed_at === "string");
});

Deno.test("restoreTodo clears removed and completed flags", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const res = await restoreTodo({ db, userId: USER_ID, params: { id: "t1" } });
  await readJson(res);

  const updateCall = calls.find((c) => c.op === "update")!;
  assertEquals(updateCall.args[0], {
    removed: false,
    removed_at: null,
    completed: false,
    completed_at: null,
  });
});

Deno.test("deletePermanent batches ids in groups of 500", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
  const res = await deletePermanent({ db, userId: USER_ID, params: { ids } });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const deleteCalls = calls.filter((c) => c.op === "delete");
  assertEquals(deleteCalls.length, 2);
  const inSizes = deleteCalls.map(
    (c) => c.filters.find((f) => f.method === "in")!.args[1].length,
  );
  assertEquals(inSizes, [500, 500]);
});

Deno.test("deleteAll deletes user's todos", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const res = await deleteAll({ db, userId: USER_ID, params: {} });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const deleteCall = calls.find((c) => c.op === "delete")!;
  assertEquals(deleteCall.filters[0], { method: "eq", args: ["user_id", USER_ID] });
});

Deno.test("bulkInsert injects user_id and batches", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const todos = Array.from({ length: 600 }, (_, i) => ({
    text: `t${i}`,
    category: "today",
  }));
  const res = await bulkInsert({ db, userId: USER_ID, params: { todos } });
  await readJson(res);

  const insertCalls = calls.filter((c) => c.op === "insert");
  assertEquals(insertCalls.length, 2);
  assertEquals(insertCalls[0].args[0].length, 500);
  assertEquals(insertCalls[1].args[0].length, 100);
  assertEquals(insertCalls[0].args[0][0].user_id, USER_ID);
});

Deno.test("archiveCompleted soft-deletes ids in batches", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const res = await archiveCompleted({
    db,
    userId: USER_ID,
    params: { ids: ["a", "b", "c"] },
  });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const updateCall = calls.find((c) => c.op === "update")!;
  assertEquals(updateCall.args[0].removed, true);
  assertEquals(
    updateCall.filters.find((f) => f.method === "in")!.args[1],
    ["a", "b", "c"],
  );
});

Deno.test("autoTransitions performs both archive and category move", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const res = await autoTransitions({
    db,
    userId: USER_ID,
    params: {
      idsToArchive: ["x1", "x2"],
      idsToMoveToThisWeek: ["m1"],
    },
  });
  const body = await readJson(res);

  assertEquals(body, { success: true });
  const updateCalls = calls.filter((c) => c.op === "update");
  // Batched: one .in() for archive (x1,x2), one .in() for move (m1)
  assertEquals(updateCalls.length, 2);
  const moveCall = updateCalls.find(
    (c) => (c.args[0] as any).category === "this_week",
  );
  assert(moveCall);
});

Deno.test("autoTransitions is a no-op with empty arrays", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const res = await autoTransitions({
    db,
    userId: USER_ID,
    params: { idsToArchive: [], idsToMoveToThisWeek: [] },
  });
  await readJson(res);

  assertEquals(calls.filter((c) => c.op === "update").length, 0);
});

Deno.test("addTodo propagates DB errors", async () => {
  const calls: Call[] = [];
  const db = buildMockDb(
    { todos: () => ({ data: null, error: { message: "boom" } }) },
    calls,
  );

  let caught: any = null;
  try {
    await addTodo({
      db,
      userId: USER_ID,
      params: { text: "x", category: "today" },
    });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught?.message, "boom");
});

// ============================================================
// Edge cases: validation + resource limits
// ============================================================

async function expectBadRequest(fn: () => Promise<unknown>, matcher?: RegExp) {
  let caught: any = null;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  assert(caught, "expected handler to throw");
  assertEquals(caught.status, 400);
  if (matcher) assert(matcher.test(String(caught.message)), `message: ${caught.message}`);
}

function noopDb() {
  return buildMockDb({ todos: () => ({ data: { id: "x" }, error: null }) }, []);
}

// ---------- addTodo validation ----------

Deno.test("addTodo rejects empty text", async () => {
  await expectBadRequest(
    () => addTodo({ db: noopDb(), userId: USER_ID, params: { text: "   ", category: "today" } }),
    /text/i,
  );
});

Deno.test("addTodo rejects missing text", async () => {
  await expectBadRequest(
    () => addTodo({ db: noopDb(), userId: USER_ID, params: { category: "today" } }),
    /text/i,
  );
});

Deno.test("addTodo rejects text over 2000 chars", async () => {
  await expectBadRequest(
    () => addTodo({
      db: noopDb(),
      userId: USER_ID,
      params: { text: "a".repeat(2001), category: "today" },
    }),
    /text/i,
  );
});

Deno.test("addTodo rejects unknown category", async () => {
  await expectBadRequest(
    () => addTodo({
      db: noopDb(),
      userId: USER_ID,
      params: { text: "hi", category: "someday" },
    }),
    /category/i,
  );
});

Deno.test("addTodo rejects missing category", async () => {
  await expectBadRequest(
    () => addTodo({ db: noopDb(), userId: USER_ID, params: { text: "hi" } }),
    /category/i,
  );
});

// ---------- updateTodo validation + whitelist ----------

Deno.test("updateTodo throws when id missing", async () => {
  await expectBadRequest(
    () => updateTodo({ db: noopDb(), userId: USER_ID, params: { text: "x" } }),
    /id/i,
  );
});

Deno.test("updateTodo throws when no whitelisted fields present", async () => {
  await expectBadRequest(
    () => updateTodo({
      db: noopDb(),
      userId: USER_ID,
      params: { id: "t1", foo: "bar", user_id: "other" },
    }),
    /no valid fields/i,
  );
});

Deno.test("updateTodo drops non-whitelisted keys before DB write", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const res = await updateTodo({
    db,
    userId: USER_ID,
    params: {
      id: "t1",
      text: "ok",
      foo: "bar",
      user_id: "attacker",
      next_recurrence_at: "1970-01-01",
      recurring_source_id: "x",
    },
  });
  await readJson(res);

  const updateCall = calls.find((c) => c.op === "update")!;
  const payload = updateCall.args[0] as Record<string, unknown>;
  assertEquals(payload.text, "ok");
  assertEquals(payload.next_recurrence_at, "1970-01-01");
  assert(!("foo" in payload));
  assert(!("user_id" in payload));
  assert(!("recurring_source_id" in payload));
});

Deno.test("updateTodo validates supplied category", async () => {
  await expectBadRequest(
    () => updateTodo({
      db: noopDb(),
      userId: USER_ID,
      params: { id: "t1", category: "someday" },
    }),
    /category/i,
  );
});

Deno.test("updateTodo rejects notes over 50000 chars", async () => {
  await expectBadRequest(
    () => updateTodo({
      db: noopDb(),
      userId: USER_ID,
      params: { id: "t1", notes: "n".repeat(50001) },
    }),
    /notes/i,
  );
});

// ---------- tag / url / recurrence validation ----------

Deno.test("validation rejects too many tags", async () => {
  await expectBadRequest(
    () => addTodo({
      db: noopDb(),
      userId: USER_ID,
      params: {
        text: "x",
        category: "today",
        tags: Array.from({ length: 51 }, (_, i) => `t${i}`),
      },
    }),
    /tags/i,
  );
});

Deno.test("validation rejects oversized tag string", async () => {
  await expectBadRequest(
    () => addTodo({
      db: noopDb(),
      userId: USER_ID,
      params: { text: "x", category: "today", tags: ["a".repeat(101)] },
    }),
    /tag/i,
  );
});

Deno.test("validation rejects too many urls", async () => {
  await expectBadRequest(
    () => addTodo({
      db: noopDb(),
      userId: USER_ID,
      params: {
        text: "x",
        category: "today",
        urls: Array.from({ length: 21 }, (_, i) => `https://e.com/${i}`),
      },
    }),
    /urls/i,
  );
});

Deno.test("validation rejects oversized url string", async () => {
  await expectBadRequest(
    () => addTodo({
      db: noopDb(),
      userId: USER_ID,
      params: { text: "x", category: "today", urls: ["a".repeat(2001)] },
    }),
    /url/i,
  );
});

Deno.test("validation rejects invalid recurrence", async () => {
  await expectBadRequest(
    () => updateTodo({
      db: noopDb(),
      userId: USER_ID,
      params: { id: "t1", recurrence: "yearly" },
    }),
    /recurrence/i,
  );
});

Deno.test("validation accepts null recurrence", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);
  const res = await updateTodo({
    db,
    userId: USER_ID,
    params: { id: "t1", recurrence: null },
  });
  await readJson(res);
  const updateCall = calls.find((c) => c.op === "update")!;
  assertEquals((updateCall.args[0] as any).recurrence, null);
});

// ---------- bulkInsert edge cases ----------

Deno.test("bulkInsert rejects non-array todos", async () => {
  await expectBadRequest(
    () => bulkInsert({ db: noopDb(), userId: USER_ID, params: { todos: "nope" } }),
    /todos/i,
  );
});

Deno.test("bulkInsert rejects over 2000 todos", async () => {
  const todos = Array.from({ length: 2001 }, () => ({ text: "x", category: "today" }));
  await expectBadRequest(
    () => bulkInsert({ db: noopDb(), userId: USER_ID, params: { todos } }),
    /too many/i,
  );
});

Deno.test("bulkInsert fails fast on any invalid item", async () => {
  await expectBadRequest(
    () => bulkInsert({
      db: noopDb(),
      userId: USER_ID,
      params: {
        todos: [
          { text: "ok", category: "today" },
          { text: "bad", category: "invalid" },
        ],
      },
    }),
    /category/i,
  );
});

Deno.test("bulkInsert whitelist drops injected fields", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  await bulkInsert({
    db,
    userId: USER_ID,
    params: {
      todos: [
        {
          text: "t",
          category: "today",
          id: "attacker-uuid",
          created_at: "1970-01-01",
          updated_at: "1970-01-01",
          next_recurrence_at: "1970-01-01",
          recurring_source_id: "x",
          user_id: "attacker",
        },
      ],
    },
  });

  const insertCall = calls.find((c) => c.op === "insert")!;
  const row = (insertCall.args[0] as any[])[0];
  assertEquals(row.user_id, USER_ID);
  assertEquals(row.text, "t");
  assert(!("id" in row));
  assert(!("created_at" in row));
  assert(!("updated_at" in row));
  assert(!("next_recurrence_at" in row));
  assert(!("recurring_source_id" in row));
});

// ---------- deletePermanent / archiveCompleted limits ----------

Deno.test("deletePermanent rejects non-array ids", async () => {
  await expectBadRequest(
    () => deletePermanent({ db: noopDb(), userId: USER_ID, params: { ids: "nope" } }),
    /ids/i,
  );
});

Deno.test("deletePermanent rejects over 1000 ids", async () => {
  const ids = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
  await expectBadRequest(
    () => deletePermanent({ db: noopDb(), userId: USER_ID, params: { ids } }),
    /too many/i,
  );
});

Deno.test("archiveCompleted rejects over 1000 ids", async () => {
  const ids = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
  await expectBadRequest(
    () => archiveCompleted({ db: noopDb(), userId: USER_ID, params: { ids } }),
    /too many/i,
  );
});

// ---------- autoTransitions limits + batching ----------

Deno.test("autoTransitions rejects over 1000 idsToArchive", async () => {
  const ids = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
  await expectBadRequest(
    () => autoTransitions({
      db: noopDb(),
      userId: USER_ID,
      params: { idsToArchive: ids, idsToMoveToThisWeek: [] },
    }),
    /too many/i,
  );
});

Deno.test("autoTransitions rejects over 1000 idsToMoveToThisWeek", async () => {
  const ids = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
  await expectBadRequest(
    () => autoTransitions({
      db: noopDb(),
      userId: USER_ID,
      params: { idsToArchive: [], idsToMoveToThisWeek: ids },
    }),
    /too many/i,
  );
});

Deno.test("autoTransitions batches large id arrays via .in()", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  const idsToArchive = Array.from({ length: 750 }, (_, i) => `a${i}`);
  const idsToMoveToThisWeek = Array.from({ length: 600 }, (_, i) => `m${i}`);

  await autoTransitions({
    db,
    userId: USER_ID,
    params: { idsToArchive, idsToMoveToThisWeek },
  });

  const updateCalls = calls.filter((c) => c.op === "update");
  assertEquals(updateCalls.length, 4);
  const inSizes = updateCalls
    .map((c) => c.filters.find((f) => f.method === "in")!.args[1].length)
    .sort((a, b) => a - b);
  assertEquals(inSizes, [100, 250, 500, 500]);
});

Deno.test("autoTransitions skips category-move when idsToMoveToThisWeek undefined", async () => {
  const calls: Call[] = [];
  const db = buildMockDb({ todos: () => ({ error: null }) }, calls);

  await autoTransitions({
    db,
    userId: USER_ID,
    params: { idsToArchive: ["a1"] },
  });

  const updateCalls = calls.filter((c) => c.op === "update");
  assertEquals(updateCalls.length, 1);
  assertEquals((updateCalls[0].args[0] as any).removed, true);
});
