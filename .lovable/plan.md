## Add `user_id` to `todo_images` for direct ownership checks

Address the `todo_images_no_user_id_column` finding by adding a denormalized `user_id` column to `todo_images`, backfilling it, enforcing it on insert, and including it directly in RLS policies alongside the existing join check.

### Migration

1. `ALTER TABLE public.todo_images ADD COLUMN user_id uuid;`
2. Backfill: `UPDATE public.todo_images ti SET user_id = t.user_id FROM public.todos t WHERE t.id = ti.todo_id;`
3. `ALTER TABLE public.todo_images ALTER COLUMN user_id SET NOT NULL;`
4. Add index: `CREATE INDEX idx_todo_images_user_id ON public.todo_images(user_id);`
5. Trigger to keep `user_id` in sync / prevent tampering on insert:
   ```sql
   CREATE OR REPLACE FUNCTION public.set_todo_image_user_id()
   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
   BEGIN
     SELECT user_id INTO NEW.user_id FROM public.todos WHERE id = NEW.todo_id;
     IF NEW.user_id IS NULL THEN RAISE EXCEPTION 'Parent todo not found'; END IF;
     RETURN NEW;
   END $$;
   CREATE TRIGGER trg_set_todo_image_user_id
   BEFORE INSERT ON public.todo_images
   FOR EACH ROW EXECUTE FUNCTION public.set_todo_image_user_id();
   ```
6. Drop and recreate the three RLS policies to add `user_id = auth.uid()` as the primary check in addition to the existing todos-join check:
   ```sql
   CREATE POLICY "Users can view own todo images" ON public.todo_images FOR SELECT
   USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.todos WHERE id = todo_images.todo_id AND user_id = auth.uid()));
   -- same pattern for INSERT (WITH CHECK) and DELETE (USING)
   ```

### Code changes

- `supabase/functions/images-api/index.ts` — `uploadImage` inserts into `todo_images`: add `user_id: userId` to the insert payload (trigger will also enforce, but be explicit).
- `supabase/functions/process-recurring-tasks/index.ts` — when cloning image rows for the next recurrence, include `user_id` on the inserted rows (use the new todo's user_id).
- `supabase/functions/todos-api/index.ts` — read path at line 146 is unaffected, but no other changes needed.

### Tests

- `images-api/index.test.ts`: assert the `insert-image` payload includes `user_id: USER_ID`.
- Optionally add a test that `process-recurring-tasks` copies image rows with the new owner's `user_id`.

### Out of scope

- The unrelated `user_roles_admin_self_grant` finding — separate plan.
