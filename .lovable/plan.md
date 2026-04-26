## Goal

Refactor `supabase/functions/user-api/index.ts` so each operation lives in its own dedicated, exported handler function instead of a 9-case `switch`. Mirror the structure already used in `todos-api` after the previous refactor. Single edge function — no new functions deployed.

## Current state

`user-api/index.ts` (~182 lines) wraps a 9-case `switch` (`get_filters`, `upsert_filters`, `get_onboarding`, `complete_onboarding`, `check_admin`, `get_weekly_reports`, `get_language`, `set_language`, `get_features`) inside `Deno.serve`, with auth, latency logging, and error handling inlined around it.

## New internal structure (single file)

```text
1. Constants + CORS
2. Helpers: json(), authenticate(), logLatency()
   - DbClient typed as `any` (matches todos-api workaround for the
     untyped createClient returning `never` on overloads)
3. Handler type:
     type Ctx = { db: DbClient; userId: string; params: any };
     type Handler = (ctx: Ctx) => Promise<Response>;
4. One exported handler per action:
     getFilters, upsertFilters,
     getOnboarding, completeOnboarding,
     checkAdmin,
     getWeeklyReports,
     getLanguage, setLanguage,
     getFeatures
5. Action registry mapping snake_case action → handler function
6. Exported `handleRequest(req)` dispatcher:
     - OPTIONS → CORS
     - authenticate(req) → { userId, db }
     - parse body, lookup handler, 400 on unknown action
     - try/catch with `{ error }` envelope
     - finally: logLatency once, using existing db or a fresh service client
7. Deno.serve(handleRequest)
```

## Behavior preserved

- Single deployed function name `user-api`; no edge function adds/deletes.
- All 9 action names, payload shapes, response shapes (`{ success: true }`, `{ isAdmin }`, `{ language }`, `{ features }`, raw arrays, etc.), status codes, and the `{ error: message }` envelope are unchanged.
- `api_latency_logs` continues to be written with `function_name = "user-api"` and the original `action` strings — Admin dashboard latency stats unaffected.
- 0.2 sampling rate, CORS headers, JWT validation flow all identical.
- Frontend callers (`useFilters`, `useOnboarding`, `useAdminCheck`, `useWeeklyReports`, `I18nContext`, `useFeatureAccess`, etc.) need no changes — same `invoke("user-api", { action: "...", ... })` contract.

## Benefits

- Each operation is independently readable and unit-testable as a named export, matching the `todos-api` test pattern.
- Cross-cutting concerns (auth, timing, error capture, latency logging) live in exactly one place — the dispatcher.
- Adding a new operation = write one handler + one registry entry, no `switch` editing.
- Enables follow-up work to add Deno unit tests for `user-api` using the same chainable mock approach as `todos-api/index.test.ts`.

## Out of scope

- Splitting into multiple edge functions.
- Changing action names, payload shapes, or auth model.
- Adding new test files (can be a follow-up; this plan only refactors source).
- Touching other functions (`todos-api`, `admin-api`, `images-api`, etc.).
