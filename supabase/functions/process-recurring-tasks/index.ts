import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function addInterval(date: Date, recurrence: string): Date {
  const d = new Date(date);
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Authenticate: require either a valid x-cron-secret or service-role bearer token.
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

    if (!secretOk && !serviceRoleOk) {
      return json({ error: "Unauthorized" }, 401);
    }


    // Find all todos with next_recurrence_at <= now
    const { data: dueTodos, error: fetchErr } = await db
      .from("todos")
      .select("*")
      .not("next_recurrence_at", "is", null)
      .lte("next_recurrence_at", new Date().toISOString());

    if (fetchErr) throw fetchErr;
    if (!dueTodos || dueTodos.length === 0) return json({ processed: 0 });

    let processed = 0;

    for (const todo of dueTodos) {
      // Check if user has recurrence feature enabled
      const { data: features } = await db
        .from("user_features")
        .select("id")
        .eq("user_id", todo.user_id)
        .eq("feature", "recurrence")
        .eq("enabled", true)
        .or("expires_at.is.null,expires_at.gt." + new Date().toISOString());

      if (!features || features.length === 0) {
        // User lost access — clear recurrence on source
        await db
          .from("todos")
          .update({ recurrence: null, next_recurrence_at: null })
          .eq("id", todo.id);
        continue;
      }

      // Clone the todo
      const now = new Date().toISOString();
      const newNextRecurrence = addInterval(new Date(), todo.recurrence).toISOString();

      const { data: inserted, error: insertErr } = await db
        .from("todos")
        .insert({
          text: todo.text,
          category: todo.category,
          tags: todo.tags,
          notes: todo.notes,
          urls: todo.urls,
          user_id: todo.user_id,
          recurrence: todo.recurrence,
          next_recurrence_at: newNextRecurrence,
          recurring_source_id: todo.id,
          completed: false,
          completed_at: null,
          removed: false,
          removed_at: null,
        })
        .select("id")
        .single();

      if (insertErr) {
        console.error("Failed to clone todo", todo.id, insertErr);
        continue;
      }

      // Copy todo_images references
      const { data: images } = await db
        .from("todo_images")
        .select("storage_path, file_name")
        .eq("todo_id", todo.id);

      if (images && images.length > 0) {
        await db.from("todo_images").insert(
          images.map((img: any) => ({
            todo_id: inserted.id,
            storage_path: img.storage_path,
            file_name: img.file_name,
          }))
        );
      }

      // Clear recurrence on source (chain moves to clone)
      await db
        .from("todos")
        .update({ recurrence: null, next_recurrence_at: null })
        .eq("id", todo.id);

      processed++;
    }

    return json({ processed });
  } catch (e: any) {
    console.error("process-recurring-tasks error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
