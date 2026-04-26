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

// ============================================================
// Handler type
// ============================================================
type Ctx = { db: DbClient; userId: string; params: any };
type Handler = (ctx: Ctx) => Promise<Response>;

// ============================================================
// Operation handlers (one function per action)
// ============================================================
export async function listTodos({ db, userId }: Ctx): Promise<Response> {
  const { data: todos, error } = await db
    .from("todos")
    .select("*")
    .eq("user_id", userId)
    .eq("removed", false)
    .order("created_at", { ascending: false });
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

export async function listArchived({ db, userId, params }: Ctx): Promise<Response> {
  const { searchText, pageSize, pageOffset } = params;
  if (searchText) {
    const term = String(searchText).trim().toLowerCase();
    const { data, error } = await db
      .from("todos")
      .select("*")
      .eq("user_id", userId)
      .eq("removed", true)
      .order("removed_at", { ascending: false });
    if (error) throw error;

    const matched = (data ?? []).filter((todo: any) => {
      const text = String(todo.text ?? "").toLowerCase();
      const notes = String(todo.notes ?? "").toLowerCase();
      const urls = Array.isArray(todo.urls) ? todo.urls.join(" ").toLowerCase() : "";
      return text.includes(term) || notes.includes(term) || urls.includes(term);
    });

    const start = Number(pageOffset) || 0;
    const size = Number(pageSize) || 20;
    return json(matched.slice(start, start + size));
  }

  const from = pageOffset;
  const to = from + pageSize - 1;
  const { data, error } = await db
    .from("todos")
    .select("*")
    .eq("user_id", userId)
    .eq("removed", true)
    .order("removed_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return json(data ?? []);
}

export async function countArchived({ db, userId, params }: Ctx): Promise<Response> {
  const { searchText } = params;
  if (searchText) {
    const term = String(searchText).trim().toLowerCase();
    const { data, error } = await db
      .from("todos")
      .select("text, notes, urls")
      .eq("user_id", userId)
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
    .eq("removed", true);
  if (error) throw error;
  return json({ count: count ?? 0 });
}

export async function addTodo({ db, userId, params }: Ctx): Promise<Response> {
  const { text, category } = params;
  const { data: inserted, error } = await db
    .from("todos")
    .insert({ text, category, user_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  return json({ success: true, id: inserted.id });
}

export async function updateTodo({ db, userId, params }: Ctx): Promise<Response> {
  const { id, action: _a, ...updates } = params;
  const { error } = await db.from("todos").update(updates).eq("id", id).eq("user_id", userId);
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

export async function deletePermanent({ db, userId, params }: Ctx): Promise<Response> {
  const { ids } = params;
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const { error } = await db.from("todos").delete().in("id", batch).eq("user_id", userId);
    if (error) throw error;
  }
  return json({ success: true });
}

export async function deleteAll({ db, userId }: Ctx): Promise<Response> {
  const { error } = await db.from("todos").delete().eq("user_id", userId);
  if (error) throw error;
  return json({ success: true });
}

export async function bulkInsert({ db, userId, params }: Ctx): Promise<Response> {
  const { todos } = params;
  const rows = todos.map((t: any) => ({ ...t, user_id: userId }));
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await db.from("todos").insert(batch);
    if (error) throw error;
  }
  return json({ success: true });
}

export async function archiveCompleted({ db, userId, params }: Ctx): Promise<Response> {
  const { ids } = params;
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const { error } = await db
      .from("todos")
      .update({ removed: true, removed_at: now })
      .in("id", batch)
      .eq("user_id", userId);
    if (error) throw error;
  }
  return json({ success: true });
}

export async function autoTransitions({ db, userId, params }: Ctx): Promise<Response> {
  const { idsToArchive, idsToMoveToThisWeek } = params;
  const now = new Date().toISOString();
  if (idsToArchive?.length > 0) {
    for (const id of idsToArchive) {
      await db.from("todos").update({ removed: true, removed_at: now }).eq("id", id).eq("user_id", userId);
    }
  }
  if (idsToMoveToThisWeek?.length > 0) {
    for (const id of idsToMoveToThisWeek) {
      await db
        .from("todos")
        .update({ category: "this_week", created_at: now })
        .eq("id", id)
        .eq("user_id", userId);
    }
  }
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
  auto_transitions: autoTransitions,
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
    statusCode = e.status || 500;
    return json({ error: e.message || "Internal error" }, statusCode);
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
