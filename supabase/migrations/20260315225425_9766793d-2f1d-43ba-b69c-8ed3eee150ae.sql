CREATE TABLE public.user_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  feature text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, feature)
);

ALTER TABLE public.user_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own features" ON public.user_features
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage features" ON public.user_features
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));