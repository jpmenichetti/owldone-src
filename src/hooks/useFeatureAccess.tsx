import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type FeatureAccessContextType = {
  features: string[];
  hasFeature: (feature: string) => boolean;
  loading: boolean;
};

const FeatureAccessContext = createContext<FeatureAccessContextType>({
  features: [],
  hasFeature: () => false,
  loading: true,
});

export const FeatureAccessProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [features, setFeatures] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setFeatures([]);
      setLoading(false);
      return;
    }

    setLoading(true);
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

  return (
    <FeatureAccessContext.Provider value={{ features, hasFeature, loading }}>
      {children}
    </FeatureAccessContext.Provider>
  );
};

export function useFeatureAccess() {
  return useContext(FeatureAccessContext);
}
