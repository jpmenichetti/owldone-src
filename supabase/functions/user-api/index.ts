import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SAMPLE_RATE = 0.2;
const FUNCTION_NAME = "user-api";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

function logLatency(db: ReturnType<typeof createClient>, action: string, durationMs: number, statusCode: number, userId?: string) {
  if (Math.random() >= SAMPLE_RATE) return;
  db.from("api_latency_logs").insert({
    function_name: FUNCTION_NAME,
    action,
    duration_ms: Math.round(durationMs),
    status_code: statusCode,
    user_id: userId,
  }).then();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = performance.now();
  let action = "unknown";
  let userId: string | undefined;

  try {
    const auth = await authenticate(req);
    userId = auth.userId;
    const { db } = auth;
    const body = await req.json();
    action = body.action;
    const params = body;

    let resp: Response;

    switch (action) {
      case "get_filters": {
        const { data, error } = await db
          .from("user_filters")
          .select("show_overdue, selected_tags")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        resp = json(data ?? { show_overdue: false, selected_tags: [] });
        break;
      }

      case "upsert_filters": {
        const { show_overdue, selected_tags } = params;
        const { error } = await db
          .from("user_filters")
          .upsert({ user_id: userId, show_overdue, selected_tags }, { onConflict: "user_id" });
        if (error) throw error;
        resp = json({ success: true });
        break;
      }

      case "get_onboarding": {
        const { data, error } = await db
          .from("user_preferences")
          .select("onboarding_completed")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        const showOnboarding = !data ? true : !data.onboarding_completed;
        resp = json({ showOnboarding });
        break;
      }

      case "complete_onboarding": {
        const { error } = await db
          .from("user_preferences")
          .upsert({ user_id: userId, onboarding_completed: true }, { onConflict: "user_id" });
        if (error) throw error;
        resp = json({ success: true });
        break;
      }

      case "check_admin": {
        const { data } = await db
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "admin")
          .maybeSingle();
        resp = json({ isAdmin: !!data });
        break;
      }

      case "get_weekly_reports": {
        const { data, error } = await db
          .from("weekly_reports")
          .select("*")
          .eq("user_id", userId)
          .order("week_start", { ascending: false })
          .limit(12);
        if (error) throw error;
        resp = json(data ?? []);
        break;
      }

      case "get_language": {
        const { data, error } = await db
          .from("user_preferences")
          .select("language")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        resp = json({ language: data?.language ?? "en" });
        break;
      }

      case "set_language": {
        const { language } = params;
        const { error } = await db
          .from("user_preferences")
          .upsert({ user_id: userId, language }, { onConflict: "user_id" });
        if (error) throw error;
        resp = json({ success: true });
        break;
      }

      case "get_features": {
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
        resp = json({ features: active });
        break;
      }

      default:
        resp = json({ error: `Unknown action: ${action}` }, 400);
        logLatency(db, action, performance.now() - t0, 400, userId);
        return resp;
    }

    logLatency(db, action, performance.now() - t0, 200, userId);
    return resp;
  } catch (e: any) {
    const status = e.status || 500;
    try {
      const sc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      logLatency(sc, action, performance.now() - t0, status, userId);
    } catch {}
    return json({ error: e.message || "Internal error" }, status);
  }
});
