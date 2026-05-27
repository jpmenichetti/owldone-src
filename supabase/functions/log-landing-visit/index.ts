import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-landing-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export const BodySchema = z.object({
  source: z.enum(["google_ads", "google_organic"]),
  landing_path: z.string().max(2048).default("/"),
  gclid: z.string().max(512).nullish(),
  utm_source: z.string().max(255).nullish(),
  utm_medium: z.string().max(255).nullish(),
  utm_campaign: z.string().max(255).nullish(),
  utm_term: z.string().max(255).nullish(),
  utm_content: z.string().max(255).nullish(),
  referrer: z.string().max(2048).nullish(),
  language: z.string().max(64).nullish(),
});

// In-memory rate limit: 20 req/min per IP
export const RATE_LIMIT = 20;
export const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.reset < now) {
    buckets.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  b.count++;
  return b.count > RATE_LIMIT;
}

// Test helper — reset rate-limit state between Deno tests.
export function _resetRateLimit() {
  buckets.clear();
}

// Daily-rotating obfuscation token. Mirrors src/lib/landingToken.ts.
const TOKEN_SEED = "owldone-landing-v1";
export async function expectedToken(): Promise<string> {
  const d = new Date();
  const day = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  const bytes = new TextEncoder().encode(`${TOKEN_SEED}:${day}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

// Injectable client factory so tests can stub Supabase entirely.
type ClientFactory = (url: string, key: string, opts?: any) => any;
let _createClient: ClientFactory = createClient as any;
export function _setClientFactory(fn: ClientFactory | null) {
  _createClient = fn ?? (createClient as any);
}

export const handleRequest = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Defense-in-depth: reject calls missing the daily-rotating obfuscation token.
    const provided = req.headers.get("x-landing-token") || "";
    const expected = await expectedToken();
    if (provided !== expected) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    if (rateLimited(ip)) {
      return new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const body = parsed.data;

    // Best-effort: capture authenticated user if a JWT was sent
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const userClient = _createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
        if (data?.claims?.sub) userId = data.claims.sub as string;
      } catch { /* anonymous visitor */ }
    }

    const userAgent = (req.headers.get("user-agent") || "").slice(0, 1024);

    const service = _createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await service.from("landing_visits").insert({
      source: body.source,
      landing_path: body.landing_path,
      gclid: body.gclid ?? null,
      utm_source: body.utm_source ?? null,
      utm_medium: body.utm_medium ?? null,
      utm_campaign: body.utm_campaign ?? null,
      utm_term: body.utm_term ?? null,
      utm_content: body.utm_content ?? null,
      referrer: body.referrer ?? null,
      user_agent: userAgent,
      language: body.language ?? null,
      user_id: userId,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

// Only start the server when running as the entrypoint, not when imported by tests.
if (import.meta.main) {
  Deno.serve(handleRequest);
}
