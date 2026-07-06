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
  name: "create_todo",
  title: "Create todo",
  description:
    "Create a new todo for the signed-in user. If workspace_id is omitted, the user's default workspace is used.",
  inputSchema: {
    text: z.string().trim().min(1).max(500).describe("Task text."),
    category: z
      .enum(["today", "this_week", "next_week", "others"])
      .default("today")
      .describe("Category bucket."),
    workspace_id: z.string().uuid().optional().describe("Target workspace."),
    tags: z.array(z.string()).optional().describe("Optional tags."),
    notes: z.string().optional().describe("Optional notes."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ text, category, workspace_id, tags, notes }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = clientFor(ctx);
    const userId = ctx.getUserId()!;

    let wsId = workspace_id;
    if (!wsId) {
      const { data: ws } = await supabase
        .from("workspaces")
        .select("id, is_default, position")
        .eq("user_id", userId)
        .order("position", { ascending: true });
      const chosen = ws?.find((w) => w.is_default) ?? ws?.[0];
      if (!chosen) {
        return { content: [{ type: "text", text: "No workspace available" }], isError: true };
      }
      wsId = chosen.id;
    }

    const { data, error } = await supabase
      .from("todos")
      .insert({
        user_id: userId,
        workspace_id: wsId,
        text,
        category,
        tags: tags ?? null,
        notes: notes ?? null,
      })
      .select("id, text, category, workspace_id")
      .single();

    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: `Created todo ${data.id}: ${data.text}` }],
      structuredContent: { todo: data },
    };
  },
});
