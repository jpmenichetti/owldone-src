
-- 1. Add column
ALTER TABLE public.todo_images ADD COLUMN user_id uuid;

-- 2. Backfill
UPDATE public.todo_images ti
SET user_id = t.user_id
FROM public.todos t
WHERE t.id = ti.todo_id;

-- 3. Enforce NOT NULL
ALTER TABLE public.todo_images ALTER COLUMN user_id SET NOT NULL;

-- 4. Index
CREATE INDEX IF NOT EXISTS idx_todo_images_user_id ON public.todo_images(user_id);

-- 5. Trigger to set user_id from parent todo (prevents tampering)
CREATE OR REPLACE FUNCTION public.set_todo_image_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT user_id INTO NEW.user_id FROM public.todos WHERE id = NEW.todo_id;
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'Parent todo not found for todo_id %', NEW.todo_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_todo_image_user_id ON public.todo_images;
CREATE TRIGGER trg_set_todo_image_user_id
BEFORE INSERT ON public.todo_images
FOR EACH ROW EXECUTE FUNCTION public.set_todo_image_user_id();

-- 6. Recreate RLS policies with direct user_id check
DROP POLICY IF EXISTS "Users can view own todo images" ON public.todo_images;
DROP POLICY IF EXISTS "Users can insert own todo images" ON public.todo_images;
DROP POLICY IF EXISTS "Users can delete own todo images" ON public.todo_images;

CREATE POLICY "Users can view own todo images" ON public.todo_images
FOR SELECT
USING (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.todos WHERE id = todo_images.todo_id AND user_id = auth.uid())
);

CREATE POLICY "Users can insert own todo images" ON public.todo_images
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.todos WHERE id = todo_images.todo_id AND user_id = auth.uid())
);

CREATE POLICY "Users can delete own todo images" ON public.todo_images
FOR DELETE
USING (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.todos WHERE id = todo_images.todo_id AND user_id = auth.uid())
);
