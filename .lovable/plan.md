

## Index Audit: Current State vs Query Patterns

### Existing Indexes

| Table | Index | Columns |
|-------|-------|---------|
| `todos` | PK only | `(id)` |
| `todo_images` | PK only | `(id)` |
| `user_features` | PK + unique | `(id)`, `(user_id, feature)` |
| `user_filters` | PK + unique | `(id)`, `(user_id)` |
| `user_preferences` | PK + unique | `(id)`, `(user_id)` |
| `user_roles` | PK + unique | `(id)`, `(user_id, role)` |
| `weekly_reports` | PK + unique | `(id)`, `(user_id, week_start)` |
| `api_latency_logs` | PK + 2 | `(id)`, `(created_at DESC)`, `(function_name, action)` |
| `admin_stats_daily` | PK + unique | `(id)`, `(stat_date)` |

### Gaps Found

**1. `todos` — Missing critical indexes** (highest impact)

Every query filters by `user_id` + `removed`, and some also filter by `completed`/`completed_at`. Without indexes, all these do full table scans:
- `list`: `WHERE user_id = ? AND removed = false ORDER BY created_at DESC`
- `list_archived` / `count_archived`: `WHERE user_id = ? AND removed = true ORDER BY removed_at DESC`
- `generate-weekly-report`: `WHERE user_id = ? AND completed = true AND completed_at BETWEEN ? AND ?`
- `process-recurring-tasks`: `WHERE next_recurrence_at IS NOT NULL AND next_recurrence_at <= now()`

**Recommended indexes:**
- `(user_id, removed, created_at DESC)` — covers `list` action and general filtering
- `(user_id, completed, completed_at)` — covers weekly report queries
- `(next_recurrence_at)` WHERE `next_recurrence_at IS NOT NULL` — partial index for recurring task cron

**2. `todo_images` — Missing `todo_id` index**

The `list` action joins images via `.in("todo_id", todoIds)`. Without an index on `todo_id`, this scans the full images table.

**Recommended index:**
- `(todo_id)`

**3. `api_latency_logs` — Missing `created_at` range + grouping index**

The latency stats functions (`get_latency_stats`, `get_latency_timeseries`) filter by `created_at` range and group by `function_name, action`. The existing `(created_at DESC)` index helps the range filter, but the purge function (`DELETE WHERE created_at < ...`) and the group-by queries could benefit from a composite index. Current indexes are adequate but not optimal.

**Optional improvement:**
- `(created_at, function_name, action)` — covers both range + grouping (replaces `idx_latency_logs_created`)

**4. `weekly_reports` — Adequate**

The unique index on `(user_id, week_start)` covers the upsert and the ordered select query. The cleanup `DELETE WHERE week_start < ?` is infrequent and on a small table. No changes needed.

**5. All other tables — Adequate**

`user_filters`, `user_preferences`, `user_roles`, `user_features` all have unique indexes on `user_id` (or `user_id, feature`/`user_id, role`) which match their query patterns perfectly.

---

### Plan: Add Missing Indexes

A single migration with 4 indexes:

```sql
-- 1. Todos: active list (user_id + removed + created_at ordering)
CREATE INDEX idx_todos_user_active ON public.todos (user_id, removed, created_at DESC);

-- 2. Todos: weekly report queries (user_id + completed + completed_at range)
CREATE INDEX idx_todos_user_completed ON public.todos (user_id, completed, completed_at);

-- 3. Todos: recurring task cron (partial index)
CREATE INDEX idx_todos_next_recurrence ON public.todos (next_recurrence_at)
  WHERE next_recurrence_at IS NOT NULL;

-- 4. Todo images: join by todo_id
CREATE INDEX idx_todo_images_todo_id ON public.todo_images (todo_id);
```

No code changes required — these are purely database-level optimizations. The `api_latency_logs` composite index is optional and can be deferred since the table is already indexed and the stats queries are admin-only/infrequent.

