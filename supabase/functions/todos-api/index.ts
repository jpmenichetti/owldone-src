import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type DbClient = any;

// ============================================================
// Constants + CORS
// ============================================================
const SAMPLE_RATE = 0.2;
const FUNCTION_NAME = "todos-api";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================
// Helpers
// ============================================================
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw { status: 401, message: "Unauthorized" };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await userClient.auth.getClaims(token);
  if (error || !data?.claims) throw { status: 401, message: "Unauthorized" };

  const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return { userId: data.claims.sub as string, db: serviceClient };
}

function logLatency(
  db: DbClient,
  action: string,
  durationMs: number,
  statusCode: number,
  userId?: string,
) {
  if (Math.random() >= SAMPLE_RATE) return;
  db.from("api_latency_logs").insert({
    function_name: FUNCTION_NAME,
    action,
    duration_ms: Math.round(durationMs),
    status_code: statusCode,
    user_id: userId,
  }).then();
}

// Resolve workspace_id: validates that it belongs to user, or falls back to default.
async function resolveWorkspaceId(
  db: DbClient,
  userId: string,
  workspaceId?: string,
): Promise<string> {
  if (workspaceId) {
    const { data } = await db
      .from("workspaces")
      .select("id")
      .eq("id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) throw { status: 403, message: "Invalid workspace" };
    return workspaceId;
  }
  // Default fallback
  const { data: existing } = await db
    .from("workspaces")
    .select("id, is_default")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (existing && existing.length > 0) {
    return (existing.find((w: any) => w.is_default) ?? existing[0]).id;
  }
  // Create default workspace lazily
  const { data: created, error } = await db
    .from("workspaces")
    .insert({ user_id: userId, name: "My tasks", is_default: true, position: 0 })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

// ============================================================
// Validation
// ============================================================
const VALID_CATEGORIES = ["today", "this_week", "next_week", "others"];
const VALID_RECURRENCE = ["daily", "weekly", "monthly"];
const ALLOWED_URL_PROTOCOLS = ["http:", "https:"];
const LIMITS = {
  text: 2000,
  notes: 50000,
  tags: 50,
  tagLen: 100,
  urls: 20,
  urlLen: 2000,
};

function bad(message: string): never {
  throw { status: 400, message };
}

function validateTodoFields(
  f: Record<string, unknown>,
  opts: { requireText?: boolean; requireCategory?: boolean } = {},
) {
  if (opts.requireText || f.text !== undefined) {
    if (typeof f.text !== "string" || f.text.trim().length === 0) bad("Invalid text");
    if ((f.text as string).length > LIMITS.text) bad(`Text exceeds ${LIMITS.text} chars`);
  }
  if (opts.requireCategory || f.category !== undefined) {
    if (typeof f.category !== "string" || !VALID_CATEGORIES.includes(f.category)) {
      bad("Invalid category");
    }
  }
  if (f.notes !== undefined && f.notes !== null) {
    if (typeof f.notes !== "string") bad("Invalid notes");
    if ((f.notes as string).length > LIMITS.notes) bad(`Notes exceeds ${LIMITS.notes} chars`);
  }
  if (f.tags !== undefined && f.tags !== null) {
    if (!Array.isArray(f.tags)) bad("Invalid tags");
    if (f.tags.length > LIMITS.tags) bad(`Too many tags (max ${LIMITS.tags})`);
    for (const t of f.tags) {
      if (typeof t !== "string" || t.length > LIMITS.tagLen) bad("Invalid tag value");
    }
  }
  if (f.urls !== undefined && f.urls !== null) {
    if (!Array.isArray(f.urls)) bad("Invalid urls");
    if (f.urls.length > LIMITS.urls) bad(`Too many urls (max ${LIMITS.urls})`);
    for (const u of f.urls) {
      if (typeof u !== "string" || u.length > LIMITS.urlLen) bad("Invalid url value");
      let parsed: URL;
      try { parsed = new URL(u); } catch { bad("Invalid url value"); }
      if (!ALLOWED_URL_PROTOCOLS.includes(parsed!.protocol)) {
        bad("URL must use http or https");
      }
    }
  }
  if (f.recurrence !== undefined && f.recurrence !== null) {
    if (typeof f.recurrence !== "string" || !VALID_RECURRENCE.includes(f.recurrence)) {
      bad("Invalid recurrence");
    }
  }
}

// ============================================================
// Handler type
// ============================================================
type Ctx = { db: DbClient; userId: string; params: any };
type Handler = (ctx: Ctx) => Promise<Response>;

// ============================================================
// Operation handlers
// ============================================================
export async function listTodos({ db, userId, params }: Ctx): Promise<Response> {
  const workspaceId = await resolveWorkspaceId(db, userId, params.workspace_id);
  const { data: todos, error } = await db
    .from("todos")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("removed", false)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;

  const todoIds = todos.map((t: any) => t.id);
  let images: any[] = [];
  if (todoIds.length > 0) {
    const { data } = await db.from("todo_images").select("*").in("todo_id", todoIds);
    images = data || [];
  }

  return json(
    todos.map((t: any) => ({
      ...t,
      images: images.filter((img: any) => img.todo_id === t.id),
    })),
  );
}

async function attachImages(db: DbClient, todos: any[]): Promise<any[]> {
  const todoIds = todos.map((t: any) => t.id);
  if (todoIds.length === 0) return todos;
  const { data } = await db.from("todo_images").select("*").in("todo_id", todoIds);
  const images = data || [];
  return todos.map((t: any) => ({
    ...t,
    images: images.filter((img: any) => img.todo_id === t.id),
  }));
}

export async function listArchived({ db, userId, params }: Ctx): Promise<Response> {
  const workspaceId = await resolveWorkspaceId(db, userId, params.workspace_id);
  const { searchText, pageSize, pageOffset } = params;
  if (searchText) {
    const term = String(searchText).trim().toLowerCase();
    const { data, error } = await db
      .from("todos")
      .select("*")
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .eq("removed", true)
      .order("removed_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw error;

    const matched = (data ?? []).filter((todo: any) => {
      const text = String(todo.text ?? "").toLowerCase();
      const notes = String(todo.notes ?? "").toLowerCase();
      const urls = Array.isArray(todo.urls) ? todo.urls.join(" ").toLowerCase() : "";
      return text.includes(term) || notes.includes(term) || urls.includes(term);
    });

    const start = Number(pageOffset) || 0;
    const size = Number(pageSize) || 20;
    const page = matched.slice(start, start + size);
    return json(await attachImages(db, page));
  }

  const from = pageOffset;
  const to = from + pageSize - 1;
  const { data, error } = await db
    .from("todos")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("removed", true)
    .order("removed_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return json(await attachImages(db, data ?? []));
}

export async function countArchived({ db, userId, params }: Ctx): Promise<Response> {
  const workspaceId = await resolveWorkspaceId(db, userId, params.workspace_id);
  const { searchText } = params;
  if (searchText) {
    const term = String(searchText).trim().toLowerCase();
    const { data, error } = await db
      .from("todos")
      .select("text, notes, urls")
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .eq("removed", true);
    if (error) throw error;

    const count = (data ?? []).filter((todo: any) => {
      const text = String(todo.text ?? "").toLowerCase();
      const notes = String(todo.notes ?? "").toLowerCase();
      const urls = Array.isArray(todo.urls) ? todo.urls.join(" ").toLowerCase() : "";
      return text.includes(term) || notes.includes(term) || urls.includes(term);
    }).length;

    return json({ count });
  }

  const { count, error } = await db
    .from("todos")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("removed", true);
  if (error) throw error;
  return json({ count: count ?? 0 });
}

export async function addTodo({ db, userId, params }: Ctx): Promise<Response> {
  const { text, category } = params;
  validateTodoFields({ text, category }, { requireText: true, requireCategory: true });
  const workspaceId = await resolveWorkspaceId(db, userId, params.workspace_id);
  const { data: inserted, error } = await db
    .from("todos")
    .insert({ text, category, user_id: userId, workspace_id: workspaceId })
    .select("id")
    .single();
  if (error) throw error;
  return json({ success: true, id: inserted.id });
}

const ALLOWED_UPDATE_FIELDS = [
  "text", "category", "tags", "notes", "urls",
  "completed", "completed_at",
  "removed", "removed_at",
  "recurrence", "next_recurrence_at",
  "created_at",
] as const;

export async function updateTodo({ db, userId, params }: Ctx): Promise<Response> {
  const { id } = params;
  if (!id) throw { status: 400, message: "Missing id" };

  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (params[key] !== undefined) updates[key] = params[key];
  }
  if (Object.keys(updates).length === 0) {
    throw { status: 400, message: "No valid fields to update" };
  }
  validateTodoFields(updates);

  const { error } = await db
    .from("todos")
    .update(updates)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return json({ success: true });
}

export async function toggleComplete({ db, userId, params }: Ctx): Promise<Response> {
  const { id, completed } = params;
  const { error } = await db
    .from("todos")
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return json({ success: true });
}

export async function removeTodo({ db, userId, params }: Ctx): Promise<Response> {
  const { id } = params;
  const { error } = await db
    .from("todos")
    .update({ removed: true, removed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return json({ success: true });
}

export async function restoreTodo({ db, userId, params }: Ctx): Promise<Response> {
  const { id } = params;
  const { error } = await db
    .from("todos")
    .update({ removed: false, removed_at: null, completed: false, completed_at: null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return json({ success: true });
}

const MAX_IDS = 1000;
const MAX_BULK_INSERT = 2000;
const BULK_INSERT_ALLOWED_FIELDS = [
  "text", "category", "tags", "notes", "urls",
  "completed", "completed_at", "removed", "removed_at", "recurrence",
] as const;

function assertIdList(ids: unknown): asserts ids is string[] {
  if (!Array.isArray(ids)) throw { status: 400, message: "Invalid ids" };
  if (ids.length > MAX_IDS) throw { status: 400, message: `Too many ids (max ${MAX_IDS})` };
}

export async function deletePermanent({ db, userId, params }: Ctx): Promise<Response> {
  const { ids } = params;
  assertIdList(ids);
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const { error } = await db.from("todos").delete().in("id", batch).eq("user_id", userId);
    if (error) throw error;
  }
  return json({ success: true });
}

export async function deleteAll({ db, userId, params }: Ctx): Promise<Response> {
  // Scope to active workspace
  const workspaceId = await resolveWorkspaceId(db, userId, params.workspace_id);
  const { error } = await db
    .from("todos")
    .delete()
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return json({ success: true });
}

export async function bulkInsert({ db, userId, params }: Ctx): Promise<Response> {
  const { todos } = params;
  if (!Array.isArray(todos)) throw { status: 400, message: "Invalid todos" };
  if (todos.length > MAX_BULK_INSERT) {
    throw { status: 400, message: `Too many todos (max ${MAX_BULK_INSERT})` };
  }
  for (const t of todos) {
    validateTodoFields(t, { requireText: true, requireCategory: true });
  }
  const workspaceId = await resolveWorkspaceId(db, userId, params.workspace_id);
  const rows = todos.map((t: any) => {
    const row: Record<string, unknown> = { user_id: userId, workspace_id: workspaceId };
    for (const k of BULK_INSERT_ALLOWED_FIELDS) {
      if (t[k] !== undefined) row[k] = t[k];
    }
    return row;
  });
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await db.from("todos").insert(batch);
    if (error) throw error;
  }
  return json({ success: true });
}

export async function archiveCompleted({ db, userId, params }: Ctx): Promise<Response> {
  const { ids } = params;
  assertIdList(ids);
  // Scope to the active workspace so a stale id list from another workspace
  // can never affect tasks outside it.
  const workspaceId = await resolveWorkspaceId(db, userId, params.workspace_id);
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const { error } = await db
      .from("todos")
      .update({ removed: true, removed_at: now })
      .in("id", batch)
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId);
    if (error) throw error;
  }
  return json({ success: true });
}


// Note: lifecycle transitions (auto-archive completed todos, next_week →
// this_week rollover) are handled by the `process-lifecycle-transitions`
// cron-scheduled edge function. They are no longer triggered per-request
// from the client.


export async function deleteTag({ db, userId, params }: Ctx): Promise<Response> {
  // Tags are shared across workspaces — delete from ALL todos for this user.
  const { tag } = params;
  if (typeof tag !== "string" || tag.length === 0 || tag.length > LIMITS.tagLen) {
    bad("Invalid tag");
  }
  const { data, error } = await db
    .from("todos")
    .select("id, tags")
    .eq("user_id", userId)
    .contains("tags", [tag]);
  if (error) throw error;
  const rows = data ?? [];
  let affected = 0;
  for (const row of rows) {
    const nextTags = (Array.isArray(row.tags) ? row.tags : []).filter((t: string) => t !== tag);
    const { error: updErr } = await db
      .from("todos")
      .update({ tags: nextTags })
      .eq("id", row.id)
      .eq("user_id", userId);
    if (updErr) throw updErr;
    affected++;
  }
  return json({ success: true, affected });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function moveWorkspace({ db, userId, params }: Ctx): Promise<Response> {
  const { id, workspace_id } = params;
  if (!id || typeof id !== "string") throw { status: 400, message: "Missing id" };
  if (!workspace_id || typeof workspace_id !== "string" || !UUID_RE.test(workspace_id)) {
    throw { status: 400, message: "Invalid workspace_id" };
  }
  // Validates the target workspace belongs to user.
  const targetId = await resolveWorkspaceId(db, userId, workspace_id);

  const { data: todo, error: todoErr } = await db
    .from("todos")
    .select("id, workspace_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (todoErr) throw todoErr;
  if (!todo) throw { status: 404, message: "Todo not found" };
  if (todo.workspace_id === targetId) return json({ success: true, unchanged: true });

  const { error } = await db
    .from("todos")
    .update({ workspace_id: targetId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return json({ success: true });
}

// ============================================================
// Action registry
// ============================================================
const handlers: Record<string, Handler> = {
  list: listTodos,
  list_archived: listArchived,
  count_archived: countArchived,
  add: addTodo,
  update: updateTodo,
  toggle_complete: toggleComplete,
  remove: removeTodo,
  restore: restoreTodo,
  delete_permanent: deletePermanent,
  delete_all: deleteAll,
  bulk_insert: bulkInsert,
  archive_completed: archiveCompleted,
  delete_tag: deleteTag,

};

// ============================================================
// Dispatcher
// ============================================================
export const handleRequest = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const t0 = performance.now();
  let action = "unknown";
  let userId: string | undefined;
  let statusCode = 200;
  let db: DbClient | undefined;

  try {
    const auth = await authenticate(req);
    userId = auth.userId;
    db = auth.db;

    const body = await req.json();
    action = body.action;

    const handler = handlers[action];
    if (!handler) {
      statusCode = 400;
      return json({ error: `Unknown action: ${action}` }, 400);
    }

    const response = await handler({ db, userId, params: body });
    statusCode = response.status;
    return response;
  } catch (e: any) {
    statusCode = Number.isInteger(e?.status) ? e.status : 500;
    const isClientError = statusCode >= 400 && statusCode < 500;
    const safeMessage = isClientError ? (e?.message || "Bad request") : "Internal server error";
    console.error("[todos-api] error", { action, statusCode, error: e });
    return json({ error: safeMessage }, statusCode);
  } finally {
    try {
      const logger =
        db ??
        createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      logLatency(logger, action, performance.now() - t0, statusCode, userId);
    } catch {}
  }
};

Deno.serve(handleRequest);
