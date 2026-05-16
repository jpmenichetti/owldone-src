
CREATE TABLE public.landing_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('google_ads', 'google_organic')),
  landing_path TEXT NOT NULL DEFAULT '/',
  gclid TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  referrer TEXT,
  user_agent TEXT,
  language TEXT,
  user_id UUID
);

CREATE INDEX idx_landing_visits_created_at ON public.landing_visits (created_at DESC);
CREATE INDEX idx_landing_visits_source ON public.landing_visits (source);

ALTER TABLE public.landing_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read landing visits"
ON public.landing_visits
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.purge_old_landing_visits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.landing_visits WHERE created_at < now() - interval '90 days';
$$;

CREATE OR REPLACE FUNCTION public.get_landing_visit_stats(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE(
  source TEXT,
  visit_count BIGINT,
  unique_campaigns BIGINT
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    source,
    count(*) AS visit_count,
    count(DISTINCT utm_campaign) FILTER (WHERE utm_campaign IS NOT NULL) AS unique_campaigns
  FROM public.landing_visits
  WHERE created_at >= p_date_from AND created_at <= p_date_to
  GROUP BY source;
$$;
