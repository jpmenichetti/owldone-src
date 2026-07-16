# Add `list_overdue_todos` MCP tool

Expose overdue tasks to MCP clients using the same rule the app already uses.

## Overdue rule (matches `src/hooks/useWorkspaceOverdueCounts.ts` + `src/lib/lifecycle.ts`)
- `category = 'today'` → overdue when `created_at` is on a strictly earlier calendar day than "now".
- `category = 'this_week'` → overdue when `now > endOfWeek(created_at)` (Sun 23:59:59.999).
- Other categories: never overdue.

Evaluation happens in the tool handler after fetching the user's active `today` / `this_week` rows, so the answer stays consistent with the UI badge.

## Files

**New:** `src/lib/mcp/tools/list-overdue-todos.ts`
- `defineTool({ name: "list_overdue_todos", ... })`
- Input:
  - `workspace_id?: uuid` — optional workspace filter.
  - `timezone?: string` — optional IANA timezone (e.g. `"America/Santiago"`) used to compute day/week boundaries. Defaults to `"UTC"`. Validated with `Intl.DateTimeFormat(tz)` in a try/catch; invalid values return an `isError` result with a clear message.
- Annotations: `readOnlyHint: true, idempotentHint: true, openWorldHint: false`.
- Handler:
  1. Auth check.
  2. Supabase user-scoped client → select `id, text, category, tags, notes, workspace_id, created_at` where `user_id = ctx.userId`, `removed = false`, `completed = false`, `category in ('today','this_week')`, optional `workspace_id`.
  3. Compute `endOfWeek` / `isAfterDay` in the requested timezone by formatting timestamps with `Intl.DateTimeFormat` (year/month/day/weekday parts) instead of relying on server local time.
  4. Return JSON text + `structuredContent: { todos }`.

**Edit:** `src/lib/mcp/index.ts`
- Import and add `listOverdueTodos` to the `tools: [...]` array.
- Update `instructions` to mention `list_overdue_todos` and the optional `timezone` param.

## Post-edit steps
1. Run `app_mcp_server--extract_mcp_manifest` to regenerate `.lovable/mcp/manifest.json`.
2. Deploy: `supabase--deploy_edge_functions` with `["mcp"]` (the Vite plugin regenerates `supabase/functions/mcp/index.ts` automatically).

No DB schema, no config, no frontend changes.
