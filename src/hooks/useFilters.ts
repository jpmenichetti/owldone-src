import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

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
  const queryClient = useQueryClient();

  // Ephemeral search state with debounce
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchText(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const filtersQuery = useQuery({
    queryKey: ["user-filters", user?.id],
    queryFn: async (): Promise<UserFilters> => {
      const data = await invoke({ action: "get_filters" });
      return data ?? { show_overdue: false, selected_tags: [] };
    },
    enabled: !!user,
  });

  const upsertFilters = useMutation({
    mutationFn: async (filters: UserFilters) => {
      await invoke({ action: "upsert_filters", ...filters });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user-filters"] }),
  });

  const showOverdue = filtersQuery.data?.show_overdue ?? false;
  const selectedTags = filtersQuery.data?.selected_tags ?? [];

  const toggleOverdue = () => {
    upsertFilters.mutate({ show_overdue: !showOverdue, selected_tags: selectedTags });
  };

  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    upsertFilters.mutate({ show_overdue: showOverdue, selected_tags: next });
  };

  const clearFilters = () => {
    upsertFilters.mutate({ show_overdue: false, selected_tags: [] });
    setSearchText("");
  };

  const hasActiveFilters = showOverdue || selectedTags.length > 0 || searchText.length > 0;

  return { showOverdue, selectedTags, toggleOverdue, toggleTag, clearFilters, hasActiveFilters, isLoading: filtersQuery.isLoading, isSaving: upsertFilters.isPending, searchText, setSearchText, debouncedSearchText };
}
