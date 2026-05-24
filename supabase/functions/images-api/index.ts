import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SAMPLE_RATE = 0.2;
const FUNCTION_NAME = "images-api";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export type DbClient = SupabaseClient;
export type Ctx = { db: DbClient; userId: string; params: any };
export type Handler = (ctx: Ctx) => Promise<Response>;

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authenticate(req: Request) {
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

  const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return { userId: data.claims.sub as string, db: serviceClient };
}

function logLatency(db: DbClient, action: string, durationMs: number, statusCode: number, userId?: string) {
  if (Math.random() >= SAMPLE_RATE) return;
  db.from("api_latency_logs").insert({
    function_name: FUNCTION_NAME,
    action,
    duration_ms: Math.round(durationMs),
    status_code: statusCode,
    user_id: userId,
  }).then();
}

export function detectImageMime(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

export function isValidImageBytes(bytes: Uint8Array): boolean {
  return detectImageMime(bytes) !== null;
}

export function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, ".");
}

export const uploadImage: Handler = async ({ db, userId, params }) => {
  const { todoId, fileBase64, fileName } = params;
  const bytes = decodeBase64(fileBase64);
  const MAX_SIZE = 10 * 1024 * 1024;
  if (bytes.length > MAX_SIZE) {
    return json({ error: "File too large. Maximum size is 10MB." }, 400);
  }

  const detectedMime = detectImageMime(bytes);
  if (!detectedMime) {
    return json({ error: "Invalid image file. Only JPEG, PNG, GIF, and WebP are allowed." }, 400);
  }

  const { data: todo } = await db.from("todos").select("id").eq("id", todoId).eq("user_id", userId).maybeSingle();
  if (!todo) return json({ error: "Todo not found" }, 404);

  const safeName = sanitizeFileName(fileName);
  const path = `${userId}/${todoId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await db.storage
    .from("todo-images")
    .upload(path, bytes, { contentType: detectedMime });
  if (uploadError) throw uploadError;

  const { error: dbError } = await db.from("todo_images").insert({
    todo_id: todoId,
    storage_path: path,
    file_name: safeName,
  });
  if (dbError) throw dbError;

  return json({ success: true });
};

export const deleteImage: Handler = async ({ db, userId, params }) => {
  const { id, storagePath } = params;
  if (!id || !storagePath) return json({ error: "Missing id or storagePath" }, 400);

  // Verify ownership: image must belong to a todo owned by the user
  const { data: img } = await db
    .from("todo_images")
    .select("id, storage_path, todos!inner(user_id)")
    .eq("id", id)
    .eq("storage_path", storagePath)
    .eq("todos.user_id", userId)
    .maybeSingle();
  if (!img) return json({ error: "Not found" }, 404);

  await db.storage.from("todo-images").remove([storagePath]);
  const { error } = await db.from("todo_images").delete().eq("id", id);
  if (error) throw error;
  return json({ success: true });
};

export const getImageUrl: Handler = async ({ db, userId, params }) => {
  const { storagePath } = params;
  if (!storagePath) return json({ error: "Missing storagePath" }, 400);

  // Verify ownership: storage paths are scoped as `${userId}/${todoId}/...`
  // Confirm via DB join to prevent path-guessing attacks.
  const { data: img } = await db
    .from("todo_images")
    .select("id, todos!inner(user_id)")
    .eq("storage_path", storagePath)
    .eq("todos.user_id", userId)
    .maybeSingle();
  if (!img) return json({ error: "Not found" }, 404);

  const { data, error } = await db.storage
    .from("todo-images")
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return json({ signedUrl: data.signedUrl });
};

export const handlers: Record<string, Handler> = {
  upload: uploadImage,
  delete: deleteImage,
  get_url: getImageUrl,
};

export const handleRequest = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = performance.now();
  let action = "unknown";
  let userId: string | undefined;

  try {
    const auth = await authenticate(req);
    userId = auth.userId;
    const { db } = auth;
    const body = await req.json();
    action = body.action;

    const handler = handlers[action];
    if (!handler) {
      const resp = json({ error: `Unknown action: ${action}` }, 400);
      logLatency(db, action, performance.now() - t0, 400, userId);
      return resp;
    }

    const resp = await handler({ db, userId, params: body });
    logLatency(db, action, performance.now() - t0, resp.status, userId);
    return resp;
  } catch (e: any) {
    const status = Number.isInteger(e?.status) ? e.status : 500;
    try {
      const sc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      logLatency(sc, action, performance.now() - t0, status, userId);
    } catch {}
    const isClientError = status >= 400 && status < 500;
    const safeMessage = isClientError ? (e?.message || "Bad request") : "Internal server error";
    console.error("[images-api] error", { action, status, error: e });
    return json({ error: safeMessage }, status);
  }
};

Deno.serve(handleRequest);
