-- Restrict client writes on weekly_reports to the owning user.
-- Service-role (used by the generate-weekly-report edge function) bypasses RLS,
-- so scheduled report generation continues to work unchanged.

CREATE POLICY "Users can insert own reports"
ON public.weekly_reports
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports"
ON public.weekly_reports
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reports"
ON public.weekly_reports
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);