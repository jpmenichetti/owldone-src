-- 1. Todos: active list (user_id + removed + created_at ordering)
CREATE INDEX idx_todos_user_active ON public.todos (user_id, removed, created_at DESC);

-- 2. Todos: weekly report queries (user_id + completed + completed_at range)
CREATE INDEX idx_todos_user_completed ON public.todos (user_id, completed, completed_at);

-- 3. Todos: recurring task cron (partial index)
CREATE INDEX idx_todos_next_recurrence ON public.todos (next_recurrence_at)
  WHERE next_recurrence_at IS NOT NULL;

-- 4. Todo images: join by todo_id
CREATE INDEX idx_todo_images_todo_id ON public.todo_images (todo_id);