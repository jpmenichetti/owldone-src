-- Explicit admin-only SELECT policy on api_latency_logs.
-- Writes are performed only by edge functions using the service role, which bypasses RLS.
-- No INSERT/UPDATE/DELETE policies are defined for client roles, so those operations are denied by default.

CREATE POLICY "Admins can read latency logs"
ON public.api_latency_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));