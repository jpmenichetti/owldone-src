import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useWorkspaces } from "./useWorkspaces";

interface UserFilters {
  show_overdue: boolean;
  selected_tags: string[];
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("user-api", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export function useFilters() {
  const { user } = useAuth();
  const { activeWorkspaceId } = useWorkspaces();
  const queryClient = useQueryClient();

  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchText(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Reset search when switching workspaces
  useEffect(() => {
    setSearchText("");
    setDebouncedSearchText("");
  }, [activeWorkspaceId]);

  const filtersQuery = useQuery({
    queryKey: ["user-filters", user?.id, activeWorkspaceId],
    queryFn: async (): Promise<UserFilters> => {
      const body: Record<string, unknown> = { action: "get_filters" };
      if (activeWorkspaceId) body.workspace_id = activeWorkspaceId;
      const data = await invoke(body);
      return data ?? { show_overdue: false, selected_tags: [] };
    },
    enabled: !!user && !!activeWorkspaceId,
  });

  const upsertFilters = useMutation({
    mutationFn: async (filters: UserFilters & { _source?: "overdue" | "tag" }) => {
      const { _source, ...rest } = filters;
      const body: Record<string, unknown> = { action: "upsert_filters", ...rest };
      if (activeWorkspaceId) body.workspace_id = activeWorkspaceId;
      await invoke(body);
    },
    onMutate: async (vars) => {
      setSavingSource(vars._source ?? null);
      await queryClient.cancelQueries({ queryKey: ["user-filters", user?.id, activeWorkspaceId] });
      const previous = queryClient.getQueryData<UserFilters>(["user-filters", user?.id, activeWorkspaceId]);
      const { _source, ...optimistic } = vars;
      queryClient.setQueryData<UserFilters>(["user-filters", user?.id, activeWorkspaceId], optimistic);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["user-filters", user?.id, activeWorkspaceId], context.previous);
      }
    },
    onSettled: () => {
      setSavingSource(null);
      queryClient.invalidateQueries({ queryKey: ["user-filters", user?.id, activeWorkspaceId] });
    },
  });

  const [savingSource, setSavingSource] = useState<"overdue" | "tag" | null>(null);

  const showOverdue = filtersQuery.data?.show_overdue ?? false;
  const selectedTags = filtersQuery.data?.selected_tags ?? [];

  const toggleOverdue = () => {
    upsertFilters.mutate({ show_overdue: !showOverdue, selected_tags: selectedTags, _source: "overdue" });
  };

  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    upsertFilters.mutate({ show_overdue: showOverdue, selected_tags: next, _source: "tag" });
  };

  const clearFilters = () => {
    upsertFilters.mutate({ show_overdue: false, selected_tags: [] });
    setSearchText("");
  };

  const hasActiveFilters = showOverdue || selectedTags.length > 0 || searchText.length > 0;

  return { showOverdue, selectedTags, toggleOverdue, toggleTag, clearFilters, hasActiveFilters, isLoading: filtersQuery.isLoading, savingSource, searchText, setSearchText, debouncedSearchText };
}
