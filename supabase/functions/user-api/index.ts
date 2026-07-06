import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type DbClient = any;

// ============================================================
// Constants + CORS
// ============================================================
const SAMPLE_RATE = 0.2;
const FUNCTION_NAME = "user-api";
const MAX_WORKSPACES = 5;
const WORKSPACE_NAME_MAX = 60;

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

async function ensureDefaultWorkspace(db: DbClient, userId: string): Promise<string> {
  const { data: existing } = await db
    .from("workspaces")
    .select("id, is_default")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (existing && existing.length > 0) {
    const def = existing.find((w: any) => w.is_default) ?? existing[0];
    if (!def.is_default) {
      await db.from("workspaces").update({ is_default: true }).eq("id", def.id);
    }
    return def.id;
  }
  const { data: created, error } = await db
    .from("workspaces")
    .insert({ user_id: userId, name: "My tasks", is_default: true, position: 0 })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

async function hasWorkspacesFeature(db: DbClient, userId: string): Promise<boolean> {
  const { data } = await db
    .from("user_features")
    .select("feature, enabled, expires_at")
    .eq("user_id", userId)
    .eq("feature", "workspaces")
    .eq("enabled", true)
    .maybeSingle();
  if (!data) return false;
  if (data.expires_at && data.expires_at < new Date().toISOString()) return false;
  return true;
}

// ============================================================
// Handler type
// ============================================================
type Ctx = { db: DbClient; userId: string; params: any };
type Handler = (ctx: Ctx) => Promise<Response>;

// ============================================================
// Operation handlers
// ============================================================
export async function getFilters({ db, userId, params }: Ctx): Promise<Response> {
  const workspaceId = params.workspace_id ?? (await ensureDefaultWorkspace(db, userId));
  const { data, error } = await db
    .from("user_filters")
    .select("show_overdue, selected_tags, workspace_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return json(data ?? { show_overdue: false, selected_tags: [], workspace_id: workspaceId });
}

export async function upsertFilters({ db, userId, params }: Ctx): Promise<Response> {
  const { show_overdue, selected_tags } = params;
  const workspaceId = params.workspace_id ?? (await ensureDefaultWorkspace(db, userId));
  const { error } = await db
    .from("user_filters")
    .upsert(
      { user_id: userId, workspace_id: workspaceId, show_overdue, selected_tags },
      { onConflict: "user_id,workspace_id" },
    );
  if (error) throw error;
  return json({ success: true });
}

export async function getOnboarding({ db, userId }: Ctx): Promise<Response> {
  const { data, error } = await db
    .from("user_preferences")
    .select("onboarding_completed")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const showOnboarding = !data ? true : !data.onboarding_completed;
  return json({ showOnboarding });
}

export async function completeOnboarding({ db, userId }: Ctx): Promise<Response> {
  const { error } = await db
    .from("user_preferences")
    .upsert({ user_id: userId, onboarding_completed: true }, { onConflict: "user_id" });
  if (error) throw error;
  return json({ success: true });
}

export async function checkAdmin({ db, userId }: Ctx): Promise<Response> {
  const { data } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return json({ isAdmin: !!data });
}

export async function getWeeklyReports({ db, userId, params }: Ctx): Promise<Response> {
  const workspaceId = params.workspace_id ?? (await ensureDefaultWorkspace(db, userId));
  const { data, error } = await db
    .from("weekly_reports")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .order("week_start", { ascending: false })
    .limit(12);
  if (error) throw error;
  return json(data ?? []);
}

export async function getLanguage({ db, userId }: Ctx): Promise<Response> {
  const { data, error } = await db
    .from("user_preferences")
    .select("language")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return json({ language: data?.language ?? "en" });
}

export async function setLanguage({ db, userId, params }: Ctx): Promise<Response> {
  const { language } = params;
  const { error } = await db
    .from("user_preferences")
    .upsert({ user_id: userId, language }, { onConflict: "user_id" });
  if (error) throw error;
  return json({ success: true });
}

export async function getFeatures({ db, userId }: Ctx): Promise<Response> {
  const { data, error } = await db
    .from("user_features")
    .select("feature, enabled, expires_at")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (error) throw error;
  const now = new Date().toISOString();
  const active = (data ?? [])
    .filter((f: any) => !f.expires_at || f.expires_at > now)
    .map((f: any) => f.feature);
  return json({ features: active });
}

// ----- Workspaces -----
export async function listWorkspaces({ db, userId }: Ctx): Promise<Response> {
  await ensureDefaultWorkspace(db, userId);
  const { data, error } = await db
    .from("workspaces")
    .select("id, name, is_default, position, created_at")
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return json(data ?? []);
}

export async function createWorkspace({ db, userId, params }: Ctx): Promise<Response> {
  const enabled = await hasWorkspacesFeature(db, userId);
  if (!enabled) throw { status: 403, message: "Workspaces feature not enabled" };

  const name = String(params.name ?? "").trim();
  if (!name) throw { status: 400, message: "Name required" };
  if (name.length > WORKSPACE_NAME_MAX) throw { status: 400, message: "Name too long" };

  const { count } = await db
    .from("workspaces")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) >= MAX_WORKSPACES) {
    throw { status: 400, message: `Workspace limit reached (max ${MAX_WORKSPACES})` };
  }

  const { data, error } = await db
    .from("workspaces")
    .insert({ user_id: userId, name, is_default: false, position: count ?? 0 })
    .select("id, name, is_default, position, created_at")
    .single();
  if (error) {
    if (error.code === "23505") throw { status: 400, message: "Name already in use" };
    throw error;
  }
  return json(data);
}

export async function renameWorkspace({ db, userId, params }: Ctx): Promise<Response> {
  const { id } = params;
  const name = String(params.name ?? "").trim();
  if (!id) throw { status: 400, message: "Missing id" };
  if (!name) throw { status: 400, message: "Name required" };
  if (name.length > WORKSPACE_NAME_MAX) throw { status: 400, message: "Name too long" };

  const { error } = await db
    .from("workspaces")
    .update({ name })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) {
    if (error.code === "23505") throw { status: 400, message: "Name already in use" };
    throw error;
  }
  return json({ success: true });
}

export async function deleteWorkspace({ db, userId, params }: Ctx): Promise<Response> {
  const { id } = params;
  if (!id) throw { status: 400, message: "Missing id" };

  const { data: ws, error: wsErr } = await db
    .from("workspaces")
    .select("id, is_default")
    .eq("user_id", userId);
  if (wsErr) throw wsErr;
  const target = (ws ?? []).find((w: any) => w.id === id);
  if (!target) throw { status: 404, message: "Workspace not found" };
  if (target.is_default) throw { status: 400, message: "Cannot delete default workspace" };
  if ((ws ?? []).length <= 1) throw { status: 400, message: "Cannot delete last workspace" };

  const defaultWs = (ws ?? []).find((w: any) => w.is_default);
  if (!defaultWs) throw { status: 400, message: "No default workspace set" };

  // Reassign todos, weekly_reports, user_filters to the default workspace before deletion
  const { error: todosErr } = await db
    .from("todos")
    .update({ workspace_id: defaultWs.id })
    .eq("workspace_id", id)
    .eq("user_id", userId);
  if (todosErr) throw todosErr;

  const { error: reportsErr } = await db
    .from("weekly_reports")
    .update({ workspace_id: defaultWs.id })
    .eq("workspace_id", id)
    .eq("user_id", userId);
  if (reportsErr) throw reportsErr;

  // user_filters are per-workspace UI state; just delete them for the target workspace
  const { error: filtersErr } = await db
    .from("user_filters")
    .delete()
    .eq("workspace_id", id)
    .eq("user_id", userId);
  if (filtersErr) throw filtersErr;

  const { error } = await db
    .from("workspaces")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return json({ success: true });
}


export async function setDefaultWorkspace({ db, userId, params }: Ctx): Promise<Response> {
  const { id } = params;
  if (!id) throw { status: 400, message: "Missing id" };
  // Clear all defaults, then set new one
  await db.from("workspaces").update({ is_default: false }).eq("user_id", userId);
  const { error } = await db
    .from("workspaces")
    .update({ is_default: true })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return json({ success: true });
}

export async function listAllTags({ db, userId }: Ctx): Promise<Response> {
  // Tags shared across all workspaces for this user
  const { data, error } = await db
    .from("todos")
    .select("tags")
    .eq("user_id", userId);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of data ?? []) {
    for (const t of row.tags ?? []) {
      if (typeof t === "string" && t.length > 0) set.add(t);
    }
  }
  return json({ tags: Array.from(set).sort() });
}

// ----- Overdue candidate rows per workspace -----
// Return raw rows (workspace_id, category, created_at) for active, non-completed
// today/this_week todos. The client computes the actual overdue counts with the
// same `isOverdue` rule used to color the cards, so the workspace badge always
// matches the cards' visual state (which is evaluated in the browser's local
// timezone — something the server can't reproduce here).
export async function listWorkspaceOverdueCounts({ db, userId }: Ctx): Promise<Response> {
  const { data, error } = await db
    .from("todos")
    .select("workspace_id, category, created_at")
    .eq("user_id", userId)
    .eq("removed", false)
    .eq("completed", false)
    .in("category", ["today", "this_week"]);
  if (error) throw error;

  const rows = (data ?? []).filter((r: { workspace_id: string | null }) => !!r.workspace_id);
  return json({ rows });
}


// ============================================================
// Action registry
// ============================================================
const handlers: Record<string, Handler> = {
  get_filters: getFilters,
  upsert_filters: upsertFilters,
  get_onboarding: getOnboarding,
  complete_onboarding: completeOnboarding,
  check_admin: checkAdmin,
  get_weekly_reports: getWeeklyReports,
  get_language: getLanguage,
  set_language: setLanguage,
  get_features: getFeatures,
  list_workspaces: listWorkspaces,
  create_workspace: createWorkspace,
  rename_workspace: renameWorkspace,
  delete_workspace: deleteWorkspace,
  set_default_workspace: setDefaultWorkspace,
  list_all_tags: listAllTags,
  list_workspace_overdue_counts: listWorkspaceOverdueCounts,
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
    console.error("[user-api] error", { action, statusCode, error: e });
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
