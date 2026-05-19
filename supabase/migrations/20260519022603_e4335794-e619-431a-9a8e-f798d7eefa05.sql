CREATE OR REPLACE FUNCTION public.get_latency_overall_timeseries(
  p_date_from timestamptz,
  p_date_to   timestamptz,
  p_granularity text DEFAULT 'daily'
)
RETURNS TABLE(bucket timestamptz, p50_ms numeric, p95_ms numeric, call_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    date_trunc(CASE WHEN p_granularity = 'hourly' THEN 'hour' ELSE 'day' END, created_at) AS bucket,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms)::numeric, 1) AS p50_ms,
    round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric, 1) AS p95_ms,
    count(*) AS call_count
  FROM api_latency_logs
  WHERE created_at >= p_date_from AND created_at <= p_date_to
  GROUP BY bucket
  ORDER BY bucket;
$$;