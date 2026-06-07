import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useWorkspaces } from "./useWorkspaces";

export type WeeklyReport = {
  id: string;
  user_id: string;
  workspace_id: string;
  week_start: string;
  week_end: string;
  summary: string;
  todos_count: number;
  created_at: string;
};

export function useWeeklyReports() {
  const { user } = useAuth();
  const { activeWorkspaceId } = useWorkspaces();
  const queryClient = useQueryClient();

  const reportsQuery = useQuery({
    queryKey: ["weekly-reports", user?.id, activeWorkspaceId],
    queryFn: async () => {
      const body: Record<string, unknown> = { action: "get_weekly_reports" };
      if (activeWorkspaceId) body.workspace_id = activeWorkspaceId;
      const { data, error } = await supabase.functions.invoke("user-api", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as WeeklyReport[];
    },
    enabled: !!user && !!activeWorkspaceId,
  });

  const generateReport = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (activeWorkspaceId) body.workspace_id = activeWorkspaceId;
      const { data, error } = await supabase.functions.invoke("generate-weekly-report", { body });
      if (error) throw error;

      const results = data?.results as Array<{ user_id: string; status: string }> | undefined;
      if (results && results.length > 0 && results[0].status === "no_tasks") {
        throw new Error("no_tasks");
      }
      if (results && results.length > 0 && results[0].status === "rate_limited") {
        throw new Error("rate_limited");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-reports"] });
    },
  });

  const reports = reportsQuery.data ?? [];
  const latestReport = reports.length > 0 ? reports[0] : null;

  return {
    reports,
    latestReport,
    generateReport,
    isGenerating: generateReport.isPending,
    isLoading: reportsQuery.isLoading,
  };
}
