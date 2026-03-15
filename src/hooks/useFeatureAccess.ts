import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useFeatureAccess() {
  const { user } = useAuth();
  const [features, setFeatures] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setFeatures([]);
      setLoading(false);
      return;
    }

    supabase.functions
      .invoke("user-api", { body: { action: "get_features" } })
      .then(({ data, error }) => {
        if (!error && data?.features) {
          setFeatures(data.features);
        }
        setLoading(false);
      });
  }, [user]);

  const hasFeature = (feature: string) => features.includes(feature);

  return { features, hasFeature, loading };
}
