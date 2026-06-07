import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

export type Workspace = {
  id: string;
  name: string;
  is_default: boolean;
  position: number;
  created_at: string;
};

type WorkspaceContextType = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: string) => void;
  isEnabled: boolean;
  isLoading: boolean;
  createWorkspace: (name: string) => Promise<Workspace>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  setDefaultWorkspace: (id: string) => Promise<void>;
  maxWorkspaces: number;
};

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

const STORAGE_KEY = "owldone_active_workspace";

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("user-api", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { hasFeature, loading: featureLoading } = useFeatureAccess();
  const queryClient = useQueryClient();
  const isEnabled = hasFeature("workspaces");

  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(null);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces", user?.id],
    queryFn: async (): Promise<Workspace[]> => {
      const data = await invoke({ action: "list_workspaces" });
      return data ?? [];
    },
    enabled: !!user && !featureLoading,
  });

  // Pick active workspace from localStorage or default
  useEffect(() => {
    const list = workspacesQuery.data;
    if (!list || list.length === 0) return;
    const stored = localStorage.getItem(STORAGE_KEY);
    const valid = stored && list.find((w) => w.id === stored);
    if (valid) {
      setActiveWorkspaceIdState(stored);
    } else {
      const def = list.find((w) => w.is_default) ?? list[0];
      setActiveWorkspaceIdState(def.id);
    }
  }, [workspacesQuery.data]);

  const setActiveWorkspaceId = useCallback((id: string) => {
    setActiveWorkspaceIdState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
    // Invalidate scoped queries on switch
    queryClient.invalidateQueries({ queryKey: ["todos"] });
    queryClient.invalidateQueries({ queryKey: ["archived-todos"] });
    queryClient.invalidateQueries({ queryKey: ["archived-todos-count"] });
    queryClient.invalidateQueries({ queryKey: ["weekly-reports"] });
    queryClient.invalidateQueries({ queryKey: ["user-filters"] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: async (name: string): Promise<Workspace> => {
      return await invoke({ action: "create_workspace", name });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await invoke({ action: "rename_workspace", id, name });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await invoke({ action: "delete_workspace", id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["todos"] });
      queryClient.invalidateQueries({ queryKey: ["archived-todos"] });
      queryClient.invalidateQueries({ queryKey: ["archived-todos-count"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-reports"] });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      await invoke({ action: "set_default_workspace", id });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
  });

  const workspaces = workspacesQuery.data ?? [];
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  const value: WorkspaceContextType = {
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    setActiveWorkspaceId,
    isEnabled,
    isLoading: workspacesQuery.isLoading || featureLoading,
    createWorkspace: async (name: string) => {
      const ws = await createMutation.mutateAsync(name);
      return ws;
    },
    renameWorkspace: async (id: string, name: string) => {
      await renameMutation.mutateAsync({ id, name });
    },
    deleteWorkspace: async (id: string) => {
      // If active workspace is being deleted, switch first
      if (activeWorkspaceId === id) {
        const next = workspaces.find((w) => w.id !== id);
        if (next) setActiveWorkspaceId(next.id);
      }
      await deleteMutation.mutateAsync(id);
    },
    setDefaultWorkspace: async (id: string) => {
      await setDefaultMutation.mutateAsync(id);
    },
    maxWorkspaces: 5,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaces() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaces must be used inside WorkspaceProvider");
  return ctx;
}
