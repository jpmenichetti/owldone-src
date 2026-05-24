import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine mode: manual (user JWT) or cron (service role)
    const authHeader = req.headers.get("Authorization");
    let userIds: string[] = [];
    let weekStart: Date;
    let weekEnd: Date;

    // Calculate current week (Monday-Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Check body for mode
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // no body
    }

    if (body.mode === "cron") {
      // Cron mode: require shared secret (validated against vault) OR
      // service-role bearer token. Never trust caller-supplied body fields alone.
      const providedSecret = req.headers.get("x-cron-secret");
      const bearer = authHeader?.startsWith("Bearer ")
        ? authHeader.replace("Bearer ", "")
        : null;

      const serviceRoleOk = !!bearer && bearer === serviceRoleKey;
      let secretOk = false;
      if (providedSecret) {
        const verifyClient = createClient(supabaseUrl, serviceRoleKey);
        const { data, error } = await verifyClient.rpc("verify_cron_secret", {
          _provided: providedSecret,
        });
        if (!error && data === true) secretOk = true;
      }

      if (!secretOk && !serviceRoleOk) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Cron mode: generate for all users who have completed todos this week
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { data: users, error: usersErr } = await adminClient
        .from("todos")
        .select("user_id")
        .eq("completed", true)
        .gte("completed_at", weekStart.toISOString())
        .lte("completed_at", weekEnd.toISOString());

      if (usersErr) throw usersErr;
      userIds = [...new Set((users || []).map((u: { user_id: string }) => u.user_id))];
    } else {
      // Manual mode: validate user JWT
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(
        authHeader.replace("Bearer ", "")
      );
      if (claimsErr || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userIds = [claimsData.claims.sub as string];
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const results: Array<{ user_id: string; status: string }> = [];

    for (const userId of userIds) {
      // Fetch completed & archived todos for this week
      const { data: todos, error: todosErr } = await adminClient
        .from("todos")
        .select("text, completed_at")
        .eq("user_id", userId)
        .eq("completed", true)
        .gte("completed_at", weekStart.toISOString())
        .lte("completed_at", weekEnd.toISOString());

      if (todosErr) {
        console.error(`Error fetching todos for ${userId}:`, todosErr);
        results.push({ user_id: userId, status: "error" });
        continue;
      }

      if (!todos || todos.length === 0) {
        results.push({ user_id: userId, status: "no_tasks" });
        continue;
      }

      const taskList = todos.map((t: { text: string }) => `- ${t.text}`).join("\n");

      // Call Lovable AI for summarization
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "You are a productivity assistant. Summarize the following completed tasks into a brief, natural-language weekly accomplishment report (2-4 sentences). Do NOT list the tasks — write a prose summary of what was achieved. Do NOT add any information, details, or context that is not explicitly present in the task list. Only describe what the tasks say, nothing more. Write in the same language as the majority of tasks.",
            },
            {
              role: "user",
              content: `Here are the completed tasks for the week of ${weekStart.toISOString().slice(0, 10)} to ${weekEnd.toISOString().slice(0, 10)}:\n\n${taskList}`,
            },
          ],
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error(`AI error for ${userId}:`, aiResponse.status, errText);
        if (aiResponse.status === 429) {
          results.push({ user_id: userId, status: "rate_limited" });
          continue;
        }
        if (aiResponse.status === 402) {
          results.push({ user_id: userId, status: "payment_required" });
          continue;
        }
        results.push({ user_id: userId, status: "ai_error" });
        continue;
      }

      const aiData = await aiResponse.json();
      const summary = aiData.choices?.[0]?.message?.content?.trim();

      if (!summary) {
        results.push({ user_id: userId, status: "empty_summary" });
        continue;
      }

      // Upsert into weekly_reports
      const { error: upsertErr } = await adminClient.from("weekly_reports").upsert(
        {
          user_id: userId,
          week_start: weekStart.toISOString().slice(0, 10),
          week_end: weekEnd.toISOString().slice(0, 10),
          summary,
          todos_count: todos.length,
        },
        { onConflict: "user_id,week_start" }
      );

      if (upsertErr) {
        console.error(`Upsert error for ${userId}:`, upsertErr);
        results.push({ user_id: userId, status: "upsert_error" });
        continue;
      }

      results.push({ user_id: userId, status: "success" });
    }

    // Cleanup: delete reports older than 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    await adminClient
      .from("weekly_reports")
      .delete()
      .lt("week_start", threeMonthsAgo.toISOString().slice(0, 10));

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-weekly-report error:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
