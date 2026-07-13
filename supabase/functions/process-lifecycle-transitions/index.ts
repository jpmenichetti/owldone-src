import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================
// Pure rule evaluator (UTC) — mirrors src/lib/lifecycle.ts but
// computes day/week boundaries in UTC for backend evaluation.
// ============================================================

type Category = "today" | "this_week" | "next_week" | "others";

interface TodoRow {
  id: string;
  category: string;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
}

/**
 * UTC end-of-week (Sunday 23:59:59.999 UTC) containing `date`.
 * Week is Mon→Sun. If `date` is already a Sunday (UTC), returns that Sunday EOD.
 */
export function endOfWeekUTC(date: Date): Date {
  const eow = new Date(date);
  const day = eow.getUTCDay(); // Sun=0..Sat=6
  const daysUntilSunday = (7 - day) % 7;
  eow.setUTCDate(eow.getUTCDate() + daysUntilSunday);
  eow.setUTCHours(23, 59, 59, 999);
  return eow;
}

/** True iff `now` is on a strictly later UTC calendar day than `then`. */
export function isAfterDayUTC(now: Date, then: Date): boolean {
  const a = now.toISOString().slice(0, 10);
  const b = then.toISOString().slice(0, 10);
  return a !== b && now > then;
}

export interface TransitionPlan {
  idsToArchive: string[];
  idsToMoveToThisWeek: string[];
}

export function computeTransitionsUTC(todos: TodoRow[], now: Date): TransitionPlan {
  const idsToArchive: string[] = [];
  const idsToMoveToThisWeek: string[] = [];

  for (const todo of todos) {
    const category = todo.category as Category;

    if (!todo.completed && category === "next_week") {
      const created = new Date(todo.created_at);
      if (now > endOfWeekUTC(created)) idsToMoveToThisWeek.push(todo.id);
      continue;
    }

    if (!todo.completed || !todo.completed_at) continue;
    const completedDate = new Date(todo.completed_at);

    if (category === "today") {
      if (isAfterDayUTC(now, completedDate)) idsToArchive.push(todo.id);
    } else if (category === "this_week" || category === "next_week") {
      if (now > endOfWeekUTC(completedDate)) idsToArchive.push(todo.id);
    }
  }

  return { idsToArchive, idsToMoveToThisWeek };
}

// ============================================================
// Handler
// ============================================================

export const handleRequest = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Auth: cron secret OR service-role bearer
    const authHeader = req.headers.get("Authorization");
    const providedSecret = req.headers.get("x-cron-secret");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "")
      : null;

    const serviceRoleOk = !!bearer && bearer === serviceKey;
    let secretOk = false;
    if (providedSecret) {
      const { data, error } = await db.rpc("verify_cron_secret", {
        _provided: providedSecret,
      });
      if (!error && data === true) secretOk = true;
    }
    if (!secretOk && !serviceRoleOk) return json({ error: "Unauthorized" }, 401);

    const now = new Date();
    const PAGE = 1000;
    let from = 0;
    let archived = 0;
    let moved = 0;

    // Iterate all active todos across all users / workspaces
    while (true) {
      const { data, error } = await db
        .from("todos")
        .select("id, category, completed, completed_at, created_at")
        .eq("removed", false)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;

      const plan = computeTransitionsUTC(data as TodoRow[], now);

      // Archive in chunks of 500
      for (let i = 0; i < plan.idsToArchive.length; i += 500) {
        const batch = plan.idsToArchive.slice(i, i + 500);
        const { error: upErr } = await db
          .from("todos")
          .update({ removed: true, removed_at: now.toISOString() })
          .in("id", batch);
        if (upErr) throw upErr;
        archived += batch.length;
      }

      // Move next_week → this_week (reset created_at so the new week clock starts).
      // Pin the new created_at to NOON UTC of the current UTC day. The cron
      // typically fires shortly after 00:00 UTC on Monday, which in western
      // timezones (e.g. UTC-3/-4) still falls on Sunday local — that would
      // make the client's local endOfWeek(created_at) land on the *previous*
      // Sunday EOD and the task would immediately look overdue. Noon UTC
      // lands on the same weekday for every timezone from UTC-11 to UTC+11,
      // so the rolled task is unambiguously inside the new local week.
      const noonUtc = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        12, 0, 0, 0,
      )).toISOString();
      for (let i = 0; i < plan.idsToMoveToThisWeek.length; i += 500) {
        const batch = plan.idsToMoveToThisWeek.slice(i, i + 500);
        const { error: upErr } = await db
          .from("todos")
          .update({ category: "this_week", created_at: noonUtc })
          .in("id", batch);
        if (upErr) throw upErr;
        moved += batch.length;
      }

      if (data.length < PAGE) break;
      from += PAGE;
    }

    return json({ archived, moved });
  } catch (err) {
    console.error("[process-lifecycle-transitions] error", err);
    return json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
};

Deno.serve(handleRequest);
