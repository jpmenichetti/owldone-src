import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SAMPLE_RATE = 0.2;
const FUNCTION_NAME = "admin-api";

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

async function authenticateAdmin(req: Request) {
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

  const userId = data.claims.sub as string;
  const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: roleData } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleData) throw { status: 403, message: "Forbidden" };

  return { userId, db: serviceClient };
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
    const auth = await authenticateAdmin(req);
    userId = auth.userId;
    const { db } = auth;
    const body = await req.json();
    action = body.action;
    const params = body;

    let resp: Response;

    switch (action) {
      case "get_summary": {
        const { data, error } = await db
          .from("admin_stats_summary")
          .select("*")
          .eq("id", 1)
          .single();
        if (error) throw error;
        resp = json(data);
        break;
      }

      case "get_daily": {
        const { data, error } = await db
          .from("admin_stats_daily")
          .select("*")
          .order("stat_date", { ascending: true });
        if (error) throw error;
        resp = json(data);
        break;
      }

      case "refresh": {
        const { error } = await db.rpc("compute_admin_stats");
        if (error) throw error;
        resp = json({ success: true });
        break;
      }

      case "get_latency_stats": {
        const { date_from, date_to } = params;
        const { data, error } = await db.rpc("get_latency_stats", {
          p_date_from: date_from,
          p_date_to: date_to,
        });
        if (error) throw error;
        resp = json(data);
        break;
      }

      case "get_latency_timeseries": {
        const { date_from, date_to, granularity } = params;
        const { data, error } = await db.rpc("get_latency_timeseries", {
          p_date_from: date_from,
          p_date_to: date_to,
          p_granularity: granularity || "daily",
        });
        if (error) throw error;
        resp = json(data);
        break;
      }

      case "purge_latency_logs": {
        const { error } = await db.rpc("purge_old_latency_logs");
        if (error) throw error;
        resp = json({ success: true });
        break;
      }

      case "grant_feature": {
        const { user_id: targetUserId, feature, expires_at } = params;
        const row: any = { user_id: targetUserId, feature, enabled: true };
        if (expires_at) row.expires_at = expires_at;
        const { error } = await db
          .from("user_features")
          .upsert(row, { onConflict: "user_id,feature" });
        if (error) throw error;
        resp = json({ success: true });
        break;
      }

      case "revoke_feature": {
        const { user_id: targetUserId, feature } = params;
        const { error } = await db
          .from("user_features")
          .delete()
          .eq("user_id", targetUserId)
          .eq("feature", feature);
        if (error) throw error;
        resp = json({ success: true });
        break;
      }

      case "list_user_features": {
        const { user_id: targetUserId } = params;
        const { data, error } = await db
          .from("user_features")
          .select("*")
          .eq("user_id", targetUserId);
        if (error) throw error;
        resp = json(data ?? []);
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
