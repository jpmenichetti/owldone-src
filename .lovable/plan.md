# Replace per-function p95 chart with overall p50 + p95 series

## Goal
On `/admin`, change the "p95 Latency Over Time" chart so it shows two lines aggregated across all edge functions/actions:
- **Overall p95** (all APIs combined)
- **Overall p50** (all APIs combined)

The existing per-function p95 lines are removed.

## Why a new server-side aggregation

Percentiles cannot be correctly recombined client-side from per-function values (averaging p95s is wrong). The aggregate must be computed in SQL from the raw `api_latency_logs.duration_ms` values per time bucket.

## Backend changes

Migration: add a new SQL function

```sql
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
```

The existing per-function `get_latency_timeseries` is left in place (still used elsewhere if needed, and harmless if not).

## Edge function changes (`supabase/functions/admin-api/index.ts`)

- Add a new handler `get_latency_overall_timeseries` that calls the new RPC and returns the rows. Mirror the existing `getLatencyTimeseries` handler.
- Register it in the `handlers` map.

## Frontend changes (`src/pages/Admin.tsx`)

- New type: `OverallLatencyTimeseries = { bucket: string; p50_ms: number; p95_ms: number; call_count: number }`.
- Replace `latencyTs` state + `LatencyTimeseries` type with the overall variant; rename `fetchLatency` to call `get_latency_overall_timeseries` (still fetch `get_latency_stats` in parallel for the table below).
- Remove `functionNames` derivation and the per-function `latencyChartData` reshape. The new chart data is the rows directly (`bucket`, `p50_ms`, `p95_ms`).
- Update `latencyChartConfig` to two static entries:
  - `p95_ms`: label "p95 (all APIs)", color `hsl(var(--primary))`
  - `p50_ms`: label "p50 (all APIs)", color `hsl(var(--accent))`
- Replace the `.map(fn => <Line dataKey={\`${fn}_p95\`} ... />)` block with two static `<Line>`s for `p95_ms` and `p50_ms`.
- Update the card title from `"p95 Latency Over Time (ms)"` to `"Latency Over Time — p50 & p95 (ms)"`.
- The per-function table below the chart stays as-is (it already shows p50/p95/p99 per function+action).

## Verification

- Open `/admin`, scroll to "API Latency". Chart shows exactly two lines labeled p50 and p95, both spanning the selected date range. Tooltip lists both values per bucket.
- Per-function stats table beneath the chart still renders unchanged.
- No console errors; network shows a single `admin-api` call for `get_latency_overall_timeseries`.
