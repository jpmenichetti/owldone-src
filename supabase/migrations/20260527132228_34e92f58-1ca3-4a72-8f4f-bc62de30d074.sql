
-- Lock down SECURITY DEFINER functions
-- Server-only functions: revoke from PUBLIC/anon/authenticated, grant to service_role
REVOKE EXECUTE ON FUNCTION public.count_archived_todos(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_archived_todos(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.search_archived_todos(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_archived_todos(text, integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_latency_stats(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_latency_stats(timestamptz, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_latency_timeseries(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_latency_timeseries(timestamptz, timestamptz, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_latency_overall_timeseries(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_latency_overall_timeseries(timestamptz, timestamptz, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_landing_visit_stats(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_landing_visit_stats(timestamptz, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_old_latency_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_latency_logs() TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_old_landing_visits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_landing_visits() TO service_role;

REVOKE EXECUTE ON FUNCTION public.compute_admin_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_admin_stats() TO service_role;

REVOKE EXECUTE ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;

-- has_role: needed by RLS policies for authenticated users; remove redundant self-check guard
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

-- landing_visits: explicitly deny INSERT for anon/authenticated; only service_role writes
CREATE POLICY "No client inserts to landing_visits"
ON public.landing_visits
FOR INSERT
TO anon, authenticated
WITH CHECK (false);
