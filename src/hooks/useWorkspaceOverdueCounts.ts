import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { endOfWeek, isAfterDay } from "@/lib/lifecycle";

type OverdueRow = {
  workspace_id: string;
  category: "today" | "this_week" | string;
  created_at: string;
};

// Evaluated with the same rule the card uses (local time), so the badge count
// always matches how many cards actually appear as overdue in that workspace.
function rowIsOverdue(row: OverdueRow, now: Date): boolean {
  const created = new Date(row.created_at);
  if (row.category === "today") return isAfterDay(now, created);
  if (row.category === "this_week") return now > endOfWeek(created);
  return false;
}

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
      const rows = (data?.rows ?? []) as OverdueRow[];
      const now = new Date();
      const counts: Record<string, number> = {};
      for (const row of rows) {
        if (rowIsOverdue(row, now)) {
          counts[row.workspace_id] = (counts[row.workspace_id] ?? 0) + 1;
        }
      }
      return counts;
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
  });
}
