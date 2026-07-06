import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function clientFor(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_todos",
  title: "List todos",
  description:
    "List the signed-in user's active todos. Optionally filter by category (today, this_week, next_week, others) and/or workspace_id.",
  inputSchema: {
    category: z
      .enum(["today", "this_week", "next_week", "others"])
      .optional()
      .describe("Filter to a single category."),
    workspace_id: z.string().uuid().optional().describe("Restrict to a workspace."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ category, workspace_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = clientFor(ctx);
    let query = supabase
      .from("todos")
      .select("id, text, category, tags, notes, completed, workspace_id, created_at")
      .eq("user_id", ctx.getUserId()!)
      .eq("removed", false)
      .order("created_at", { ascending: false })
      .limit(200);
    if (category) query = query.eq("category", category);
    if (workspace_id) query = query.eq("workspace_id", workspace_id);
    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { todos: data ?? [] },
    };
  },
});
