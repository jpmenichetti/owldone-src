import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function clientFor(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Return {year, month, day, weekday} for the given instant in the given IANA tz.
// weekday: 0 = Sunday .. 6 = Saturday (matches JS Date.getDay()).
function partsInTz(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

// Days from a to b, treating each as a local calendar day (a,b in same tz).
function dayDiff(a: { year: number; month: number; day: number }, b: typeof a) {
  const au = Date.UTC(a.year, a.month - 1, a.day);
  const bu = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bu - au) / 86400000);
}

export default defineTool({
  name: "list_overdue_todos",
  title: "List overdue todos",
  description:
    "List the signed-in user's overdue active todos. A `today` task is overdue when its creation day is strictly before today. A `this_week` task is overdue when the current time is past the end of its creation week (Sunday 23:59:59 local). Other categories are never overdue.",
  inputSchema: {
    workspace_id: z.string().uuid().optional().describe("Restrict to a workspace."),
    timezone: z
      .string()
      .optional()
      .describe(
        "IANA timezone (e.g. 'America/Santiago') used to compute day/week boundaries. Defaults to 'UTC'.",
      ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ workspace_id, timezone }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }

    const tz = timezone ?? "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      return {
        content: [{ type: "text", text: `Invalid timezone: ${tz}` }],
        isError: true,
      };
    }

    const supabase = clientFor(ctx);
    let query = supabase
      .from("todos")
      .select("id, text, category, tags, notes, workspace_id, created_at")
      .eq("user_id", ctx.getUserId()!)
      .eq("removed", false)
      .eq("completed", false)
      .in("category", ["today", "this_week"])
      .order("created_at", { ascending: false })
      .limit(500);
    if (workspace_id) query = query.eq("workspace_id", workspace_id);

    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }

    const now = new Date();
    const nowParts = partsInTz(now, tz);

    const overdue = (data ?? []).filter((t) => {
      if (!t.created_at) return false;
      const created = new Date(t.created_at);
      const cp = partsInTz(created, tz);
      if (t.category === "today") {
        return dayDiff(cp, nowParts) > 0;
      }
      if (t.category === "this_week") {
        // Days until Sunday (weekday 0 => 0 days remaining; else 7-weekday).
        const daysToSunday = cp.weekday === 0 ? 0 : 7 - cp.weekday;
        return dayDiff(cp, nowParts) > daysToSunday;
      }
      return false;
    });

    return {
      content: [{ type: "text", text: JSON.stringify(overdue, null, 2) }],
      structuredContent: { todos: overdue },
    };
  },
});
