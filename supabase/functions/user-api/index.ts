import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type DbClient = any;

// ============================================================
// Constants + CORS
// ============================================================
const SAMPLE_RATE = 0.2;
const FUNCTION_NAME = "user-api";

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
export async function getFilters({ db, userId }: Ctx): Promise<Response> {
  const { data, error } = await db
    .from("user_filters")
    .select("show_overdue, selected_tags")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return json(data ?? { show_overdue: false, selected_tags: [] });
}

export async function upsertFilters({ db, userId, params }: Ctx): Promise<Response> {
  const { show_overdue, selected_tags } = params;
  const { error } = await db
    .from("user_filters")
    .upsert({ user_id: userId, show_overdue, selected_tags }, { onConflict: "user_id" });
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

export async function getWeeklyReports({ db, userId }: Ctx): Promise<Response> {
  const { data, error } = await db
    .from("weekly_reports")
    .select("*")
    .eq("user_id", userId)
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
