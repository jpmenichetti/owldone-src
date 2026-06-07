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

    const authHeader = req.headers.get("Authorization");
    let userIds: string[] = [];

    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // no body
    }

    if (body.mode === "cron") {
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
    const results: Array<{ user_id: string; workspace_id?: string; status: string }> = [];

    type Job = { userId: string; workspaceId: string };
    const jobs: Job[] = [];

    if (body.mode === "cron") {
      for (const uid of userIds) {
        const { data: rows } = await adminClient
          .from("todos")
          .select("workspace_id")
          .eq("user_id", uid)
          .eq("completed", true)
          .gte("completed_at", weekStart.toISOString())
          .lte("completed_at", weekEnd.toISOString());
        const wsIds = [...new Set((rows ?? []).map((r: any) => r.workspace_id).filter(Boolean))];
        for (const wid of wsIds) jobs.push({ userId: uid, workspaceId: wid as string });
      }
    } else {
      const uid = userIds[0];
      let workspaceId = body.workspace_id as string | undefined;
      if (workspaceId) {
        const { data: owned } = await adminClient
          .from("workspaces")
          .select("id")
          .eq("id", workspaceId)
          .eq("user_id", uid)
          .maybeSingle();
        if (!owned) {
          return new Response(JSON.stringify({ error: "Invalid workspace" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        const { data: ws } = await adminClient
          .from("workspaces")
          .select("id, is_default, position")
          .eq("user_id", uid)
          .order("position", { ascending: true });
        const def = (ws ?? []).find((w: any) => w.is_default) ?? (ws ?? [])[0];
        if (!def) {
          const { data: created } = await adminClient
            .from("workspaces")
            .insert({ user_id: uid, name: "My tasks", is_default: true, position: 0 })
            .select("id")
            .single();
          workspaceId = created!.id;
        } else {
          workspaceId = def.id;
        }
      }
      jobs.push({ userId: uid, workspaceId: workspaceId! });
    }

    for (const { userId, workspaceId } of jobs) {
      const { data: todos, error: todosErr } = await adminClient
        .from("todos")
        .select("text, completed_at")
        .eq("user_id", userId)
        .eq("workspace_id", workspaceId)
        .eq("completed", true)
        .gte("completed_at", weekStart.toISOString())
        .lte("completed_at", weekEnd.toISOString());

      if (todosErr) {
        console.error(`Error fetching todos for ${userId}/${workspaceId}:`, todosErr);
        results.push({ user_id: userId, workspace_id: workspaceId, status: "error" });
        continue;
      }

      if (!todos || todos.length === 0) {
        results.push({ user_id: userId, workspace_id: workspaceId, status: "no_tasks" });
        continue;
      }

      const taskList = todos.map((t: { text: string }) => `- ${t.text}`).join("\n");

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
        console.error(`AI error for ${userId}/${workspaceId}:`, aiResponse.status, errText);
        if (aiResponse.status === 429) {
          results.push({ user_id: userId, workspace_id: workspaceId, status: "rate_limited" });
          continue;
        }
        if (aiResponse.status === 402) {
          results.push({ user_id: userId, workspace_id: workspaceId, status: "payment_required" });
          continue;
        }
        results.push({ user_id: userId, workspace_id: workspaceId, status: "ai_error" });
        continue;
      }

      const aiData = await aiResponse.json();
      const summary = aiData.choices?.[0]?.message?.content?.trim();

      if (!summary) {
        results.push({ user_id: userId, workspace_id: workspaceId, status: "empty_summary" });
        continue;
      }

      const { error: upsertErr } = await adminClient.from("weekly_reports").upsert(
        {
          user_id: userId,
          workspace_id: workspaceId,
          week_start: weekStart.toISOString().slice(0, 10),
          week_end: weekEnd.toISOString().slice(0, 10),
          summary,
          todos_count: todos.length,
        },
        { onConflict: "user_id,workspace_id,week_start" }
      );

      if (upsertErr) {
        console.error(`Upsert error for ${userId}/${workspaceId}:`, upsertErr);
        results.push({ user_id: userId, workspace_id: workspaceId, status: "upsert_error" });
        continue;
      }

      results.push({ user_id: userId, workspace_id: workspaceId, status: "success" });
    }

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cleanupQuery = adminClient
      .from("weekly_reports")
      .delete()
      .lt("week_start", threeMonthsAgo.toISOString().slice(0, 10));
    if (body.mode !== "cron" && userIds.length === 1) {
      await cleanupQuery.eq("user_id", userIds[0]);
    } else {
      await cleanupQuery;
    }

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
