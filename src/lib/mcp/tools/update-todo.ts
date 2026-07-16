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
  name: "update_todo",
  title: "Update todo",
  description:
    "Update fields of an existing todo owned by the signed-in user. Provide only the fields to change; omitted fields are left untouched. `text` is the task title, `notes` is the description, `tags` replaces the tag list, and `urls` replaces the links list.",
  inputSchema: {
    id: z.string().uuid().describe("Todo id."),
    text: z.string().trim().min(1).max(500).optional().describe("Task title."),
    notes: z.string().optional().describe("Task description / notes."),
    tags: z.array(z.string()).optional().describe("Replacement tag list."),
    urls: z.array(z.string().url()).optional().describe("Replacement list of links (URLs)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, text, notes, tags, urls }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const patch: Record<string, unknown> = {};
    if (text !== undefined) patch.text = text;
    if (notes !== undefined) patch.notes = notes;
    if (tags !== undefined) patch.tags = tags;
    if (urls !== undefined) patch.urls = urls;
    if (Object.keys(patch).length === 0) {
      return { content: [{ type: "text", text: "No fields provided to update." }], isError: true };
    }

    const supabase = clientFor(ctx);
    const { data, error } = await supabase
      .from("todos")
      .update(patch)
      .eq("id", id)
      .eq("user_id", ctx.getUserId()!)
      .select("id, text, notes, tags, urls, category, workspace_id, completed, created_at, updated_at")
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    if (!data) {
      return { content: [{ type: "text", text: "Todo not found" }], isError: true };
    }
    return {
      content: [{ type: "text", text: `Updated todo ${data.id}` }],
      structuredContent: { todo: data },
    };
  },
});
