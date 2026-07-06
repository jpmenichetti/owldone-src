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
  name: "complete_todo",
  title: "Complete todo",
  description: "Mark a todo as complete (or set completed=false to reopen it).",
  inputSchema: {
    id: z.string().uuid().describe("Todo id."),
    completed: z.boolean().default(true).describe("Completion state."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, completed }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = clientFor(ctx);
    const { data, error } = await supabase
      .from("todos")
      .update({
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .eq("user_id", ctx.getUserId()!)
      .select("id, text, completed")
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    if (!data) {
      return { content: [{ type: "text", text: "Todo not found" }], isError: true };
    }
    return {
      content: [{ type: "text", text: `Todo ${data.id} completed=${data.completed}` }],
      structuredContent: { todo: data },
    };
  },
});
