
-- 1. workspaces table
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE UNIQUE INDEX workspaces_one_default_per_user
  ON public.workspaces (user_id) WHERE is_default = true;

CREATE INDEX workspaces_user_id_idx ON public.workspaces (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workspaces" ON public.workspaces
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own workspaces" ON public.workspaces
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workspaces" ON public.workspaces
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own workspaces" ON public.workspaces
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Add workspace_id columns
ALTER TABLE public.todos ADD COLUMN workspace_id uuid;
ALTER TABLE public.weekly_reports ADD COLUMN workspace_id uuid;
ALTER TABLE public.user_filters ADD COLUMN workspace_id uuid;

-- 3. Backfill: create default workspace per existing user
INSERT INTO public.workspaces (user_id, name, is_default, position)
SELECT DISTINCT user_id, 'My tasks', true, 0
FROM (
  SELECT user_id FROM public.todos
  UNION
  SELECT user_id FROM public.weekly_reports
  UNION
  SELECT user_id FROM public.user_filters
  UNION
  SELECT id AS user_id FROM auth.users
) u
WHERE user_id IS NOT NULL
ON CONFLICT (user_id, name) DO NOTHING;

-- 4. Backfill todos/reports/filters
UPDATE public.todos t
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.user_id = t.user_id AND w.is_default = true AND t.workspace_id IS NULL;

UPDATE public.weekly_reports r
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.user_id = r.user_id AND w.is_default = true AND r.workspace_id IS NULL;

UPDATE public.user_filters f
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.user_id = f.user_id AND w.is_default = true AND f.workspace_id IS NULL;

-- 5. Constraints + indexes
ALTER TABLE public.todos
  ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT todos_workspace_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.weekly_reports
  ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT weekly_reports_workspace_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.user_filters
  ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT user_filters_workspace_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX todos_user_workspace_idx ON public.todos (user_id, workspace_id);
CREATE INDEX weekly_reports_user_workspace_idx ON public.weekly_reports (user_id, workspace_id);

-- Fix uniqueness on user_filters (it had implicit unique on user_id via upsert onConflict)
-- Drop existing unique constraint if present, add (user_id, workspace_id)
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
    WHERE conrelid = 'public.user_filters'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(user_id)%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%workspace_id%'
    LIMIT 1;
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_filters DROP CONSTRAINT %I', c);
  END IF;
END$$;

ALTER TABLE public.user_filters
  ADD CONSTRAINT user_filters_user_workspace_unique UNIQUE (user_id, workspace_id);

-- Update weekly_reports uniqueness to include workspace
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
    WHERE conrelid = 'public.weekly_reports'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(user_id, week_start)%'
    LIMIT 1;
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.weekly_reports DROP CONSTRAINT %I', c);
  END IF;
END$$;

ALTER TABLE public.weekly_reports
  ADD CONSTRAINT weekly_reports_user_week_workspace_unique UNIQUE (user_id, workspace_id, week_start);
