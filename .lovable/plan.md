

## Add Expiration Date to Feature Flags

### Database Changes

**Migration** — add `expires_at` column to `user_features`:
```sql
ALTER TABLE public.user_features
  ADD COLUMN expires_at timestamptz DEFAULT NULL;
```

`NULL` = permanent access. A timestamp means access expires after that date.

### Backend Changes

**`user-api` — `get_features` action**: Filter results to only return features where `enabled = true AND (expires_at IS NULL OR expires_at > now())`.

**`todos-api` — recurrence feature check**: Same condition when validating access.

**`process-recurring-tasks`**: Same condition when checking if a user still has recurrence access.

**`admin-api` — grant/revoke actions**: Accept an optional `expires_at` parameter when granting a feature.

### Frontend Changes

**Admin page** — feature management UI: Add a date picker for setting expiration when granting a feature. Show expiration status in the feature list.

**`useFeatureAccess` hook**: No change needed — the backend already filters expired features, so the client just checks presence.

### Files to Create/Edit
- **Migration**: add `expires_at` column to `user_features`
- **Edit**: `supabase/functions/user-api/index.ts` — filter by expiration
- **Edit**: `supabase/functions/todos-api/index.ts` — check expiration on recurrence
- **Edit**: `supabase/functions/admin-api/index.ts` — accept `expires_at` on grant
- **Edit**: `src/pages/Admin.tsx` — date picker for expiration

