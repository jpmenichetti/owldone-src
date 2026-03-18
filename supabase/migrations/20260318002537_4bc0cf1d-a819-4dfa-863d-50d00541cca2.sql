ALTER TABLE public.todos
  ADD COLUMN recurrence text DEFAULT NULL,
  ADD COLUMN next_recurrence_at timestamptz DEFAULT NULL,
  ADD COLUMN recurring_source_id uuid DEFAULT NULL;