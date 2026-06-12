import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export function useWorkspaceOverdueCounts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["workspace-overdue-counts", user?.id],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.functions.invoke("user-api", {
        body: { action: "list_workspace_overdue_counts" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.counts ?? {}) as Record<string, number>;
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
  });
}
