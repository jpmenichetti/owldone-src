import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useSimulatedTime } from "./useSimulatedTime";
import { useWorkspaces } from "./useWorkspaces";
import { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useI18n } from "@/i18n/I18nContext";
import { computeTransitions, endOfWeek, isAfterDay } from "@/lib/lifecycle";


export type Todo = Tables<"todos"> & { images?: Tables<"todo_images">[] };
export type TodoCategory = "today" | "this_week" | "next_week" | "others";

export const CATEGORY_CONFIG: Record<TodoCategory, { label: string; emoji: string; colorClass: string; bgClass: string }> = {
  today: { label: "Today", emoji: "🔴", colorClass: "text-category-today", bgClass: "bg-category-today-bg" },
  this_week: { label: "This Week", emoji: "🟠", colorClass: "text-category-week", bgClass: "bg-category-week-bg" },
  next_week: { label: "Next Week", emoji: "🟣", colorClass: "text-category-next", bgClass: "bg-category-next-bg" },
  others: { label: "Others", emoji: "🔵", colorClass: "text-category-others", bgClass: "bg-category-others-bg" },
};

async function invoke(fn: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export function useTodos(searchText = "") {
  const { user } = useAuth();
  const { getNow, simulatedDate } = useSimulatedTime();
  const { activeWorkspaceId } = useWorkspaces();
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const wsBody = (extra: Record<string, unknown> = {}) =>
    activeWorkspaceId ? { workspace_id: activeWorkspaceId, ...extra } : extra;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["todos"] });
    queryClient.invalidateQueries({ queryKey: ["archived-todos"] });
    queryClient.invalidateQueries({ queryKey: ["archived-todos-count"] });
    queryClient.invalidateQueries({ queryKey: ["all-tags"] });
  };

  // Track temp ID → real ID mappings for operations on freshly-created todos
  const idMapRef = useRef<Map<string, string>>(new Map());
  const pendingCreateIdsRef = useRef<Set<string>>(new Set());
  const pendingRemoveIdsRef = useRef<Set<string>>(new Set());
  const resolveId = useCallback((id: string) => idMapRef.current.get(id) ?? id, []);

  // Auto-archive completed todos based on lifecycle rules
  const autoArchiveMutation = useMutation({
    mutationFn: async ({ idsToArchive, idsToMoveToThisWeek }: { idsToArchive: string[]; idsToMoveToThisWeek: string[] }) => {
      await invoke("todos-api", { action: "auto_transitions", idsToArchive, idsToMoveToThisWeek });
    },
    onSuccess: invalidateAll,
  });

  const todosQuery = useQuery({
    queryKey: ["todos", user?.id, activeWorkspaceId],
    queryFn: async () => {
      const data = await invoke("todos-api", wsBody({ action: "list" }));
      return data as Todo[];
    },
    enabled: !!user && !!activeWorkspaceId,
  });


  // Real auto-archive/transitions: only when NOT simulating
  useEffect(() => {
    if (simulatedDate) return;
    const todos = todosQuery.data;
    if (!todos || autoArchiveMutation.isPending) return;

    const now = new Date();
    const idsToArchive: string[] = [];
    const idsToMoveToThisWeek: string[] = [];

    for (const todo of todos) {
      const created = new Date(todo.created_at);

      if (!todo.completed && todo.category === "next_week") {
        const endOfCreatedWeek = new Date(created);
        endOfCreatedWeek.setDate(endOfCreatedWeek.getDate() + (7 - endOfCreatedWeek.getDay()));
        endOfCreatedWeek.setHours(23, 59, 59, 999);
        if (now > endOfCreatedWeek) {
          idsToMoveToThisWeek.push(todo.id);
        }
      }

      if (!todo.completed || !todo.completed_at) continue;
      const completedDate = new Date(todo.completed_at);

      if (todo.category === "today") {
        if (now.toDateString() !== completedDate.toDateString() && now > completedDate) {
          idsToArchive.push(todo.id);
        }
      } else if (todo.category === "this_week" || todo.category === "next_week") {
        const endOfWeek = new Date(completedDate);
        endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
        endOfWeek.setHours(23, 59, 59, 999);
        if (now > endOfWeek) {
          idsToArchive.push(todo.id);
        }
      }
    }

    if (idsToArchive.length > 0 || idsToMoveToThisWeek.length > 0) {
      autoArchiveMutation.mutate({ idsToArchive, idsToMoveToThisWeek });
    }
  }, [todosQuery.data, simulatedDate]);

  const ARCHIVE_PAGE_SIZE = 20;

  const archivedCountQuery = useQuery({
    queryKey: ["archived-todos-count", user?.id, activeWorkspaceId, searchText],
    queryFn: async () => {
      const data = await invoke("todos-api", wsBody({ action: "count_archived", searchText }));
      return data.count as number;
    },
    enabled: !!user && !!activeWorkspaceId,
  });

  const archivedQuery = useInfiniteQuery({
    queryKey: ["archived-todos", user?.id, activeWorkspaceId, searchText],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * ARCHIVE_PAGE_SIZE;
      const data = await invoke("todos-api", wsBody({
        action: "list_archived",
        searchText,
        pageSize: ARCHIVE_PAGE_SIZE,
        pageOffset: from,
      }));
      return data as Todo[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < ARCHIVE_PAGE_SIZE) return undefined;
      return allPages.length;
    },
    enabled: !!user && !!activeWorkspaceId,
  });

  const addTodo = useMutation({
    mutationFn: async ({ text, category, tempId }: { text: string; category: TodoCategory; tempId: string }) => {
      const data = await invoke("todos-api", wsBody({ action: "add", text, category }));
      return { tempId, realId: data.id as string };
    },
    onMutate: async ({ text, category, tempId }) => {
      pendingCreateIdsRef.current.add(tempId);
      await queryClient.cancelQueries({ queryKey: ["todos"] });
      const previous = queryClient.getQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId]);
      const tempTodo: Todo = {
        id: tempId,
        text,
        category,
        completed: false,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        notes: null,
        tags: null,
        urls: null,
        removed: false,
        removed_at: null,
        user_id: user?.id ?? "",
        workspace_id: activeWorkspaceId ?? "",
        recurrence: null,
        next_recurrence_at: null,
        recurring_source_id: null,
      };
      queryClient.setQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId], (old) => [tempTodo, ...(old ?? [])]);
      return { previous };
    },
    onSuccess: async ({ tempId, realId }) => {
      idMapRef.current.set(tempId, realId);
      pendingCreateIdsRef.current.delete(tempId);

      if (pendingRemoveIdsRef.current.has(tempId)) {
        pendingRemoveIdsRef.current.delete(tempId);
        try {
          await invoke("todos-api", { action: "remove", id: realId });
        } catch {
          toast.error(t("todos.error.removeFailed"));
        }
        return;
      }

      queryClient.setQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId], (old) =>
        (old ?? []).map((t) => (t.id === tempId ? { ...t, id: realId } : t))
      );
    },
    onError: (_err, vars, context) => {
      pendingCreateIdsRef.current.delete(vars.tempId);
      pendingRemoveIdsRef.current.delete(vars.tempId);
      queryClient.setQueryData(["todos", user?.id, activeWorkspaceId], context?.previous);
      toast.error(t("todos.error.addFailed"));
    },
    onSettled: (_data, _error, vars) => {
      if (vars?.tempId) pendingCreateIdsRef.current.delete(vars.tempId);
      queryClient.invalidateQueries({ queryKey: ["todos"] });
      queryClient.invalidateQueries({ queryKey: ["all-tags"] });
    },
  });


  const updateTodo = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Tables<"todos">> & { id: string }) => {
      const realId = resolveId(id);
      await invoke("todos-api", { action: "update", id: realId, ...updates });
    },
    onMutate: async ({ id, ...updates }) => {
      await queryClient.cancelQueries({ queryKey: ["todos"] });
      await queryClient.cancelQueries({ queryKey: ["archived-todos"] });
      const previous = queryClient.getQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId]);
      const previousArchived = queryClient.getQueryData(["archived-todos", user?.id, activeWorkspaceId, searchText]);
      queryClient.setQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId], (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, ...updates, updated_at: new Date().toISOString() } : t))
      );
      queryClient.setQueryData<{ pages: Todo[][]; pageParams: unknown[] }>(
        ["archived-todos", user?.id, activeWorkspaceId, searchText],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) =>
              page.map((t) => (t.id === id ? { ...t, ...updates, updated_at: new Date().toISOString() } : t))
            ),
          };
        }
      );
      return { previous, previousArchived };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(["todos", user?.id, activeWorkspaceId], context?.previous);
      queryClient.setQueryData(["archived-todos", user?.id, activeWorkspaceId, searchText], context?.previousArchived);
      toast.error(t("todos.error.updateFailed"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
      queryClient.invalidateQueries({ queryKey: ["archived-todos"] });
      queryClient.invalidateQueries({ queryKey: ["all-tags"] });
    },
  });

  const toggleComplete = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const realId = resolveId(id);
      await invoke("todos-api", { action: "toggle_complete", id: realId, completed });
    },
    onMutate: async ({ id, completed }) => {
      await queryClient.cancelQueries({ queryKey: ["todos"] });
      const previous = queryClient.getQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId]);
      queryClient.setQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId], (old) =>
        (old ?? []).map((t) =>
          t.id === id ? { ...t, completed, completed_at: completed ? new Date().toISOString() : null } : t
        )
      );
      return { previous };
    },

    onError: (_err, _vars, context) => {
      queryClient.setQueryData(["todos", user?.id, activeWorkspaceId], context?.previous);
      toast.error(t("todos.error.toggleFailed"));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });

  const removeTodo = useMutation({
    mutationFn: async (id: string) => {
      const mappedId = idMapRef.current.get(id);
      if (mappedId) {
        await invoke("todos-api", { action: "remove", id: mappedId });
        return;
      }

      if (pendingCreateIdsRef.current.has(id)) {
        pendingRemoveIdsRef.current.add(id);
        return;
      }

      await invoke("todos-api", { action: "remove", id });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["todos"] });
      const previous = queryClient.getQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId]);
      queryClient.setQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId], (old) =>
        (old ?? []).filter((t) => t.id !== id)
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(["todos", user?.id, activeWorkspaceId], context?.previous);
      toast.error(t("todos.error.removeFailed"));
    },
    onSettled: invalidateAll,
  });


  const uploadImage = useMutation({
    mutationFn: async ({ todoId, file }: { todoId: string; file: File }) => {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const fileBase64 = btoa(binary);

      await invoke("images-api", {
        action: "upload",
        todoId,
        fileBase64,
        fileName: file.name,
        contentType: file.type,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
      queryClient.invalidateQueries({ queryKey: ["archived-todos"] });
    },
  });

  const deleteImage = useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string }) => {
      await invoke("images-api", { action: "delete", id, storagePath });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
      queryClient.invalidateQueries({ queryKey: ["archived-todos"] });
    },
  });

  const restoreTodo = useMutation({
    mutationFn: async (id: string) => {
      await invoke("todos-api", { action: "restore", id });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["todos"] });
      await queryClient.cancelQueries({ queryKey: ["archived-todos"] });
      const previousArchived = queryClient.getQueryData(["archived-todos", user?.id, ""]);
      // We can't easily move to active cache without full data, just invalidate on settle
      return { previousArchived };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(["archived-todos", user?.id, ""], context?.previousArchived);
      toast.error(t("todos.error.restoreFailed"));
    },
    onSettled: invalidateAll,
  });

  const permanentlyDeleteTodos = useMutation({
    mutationFn: async (ids: string[]) => {
      await invoke("todos-api", { action: "delete_permanent", ids });
    },
    onSuccess: invalidateAll,
  });

  const deleteAllTodos = useMutation({
    mutationFn: async () => {
      await invoke("todos-api", wsBody({ action: "delete_all" }));
    },
    onSuccess: invalidateAll,
  });

  const bulkInsertTodos = useMutation({
    mutationFn: async (todos: Array<{
      text: string; category: string; tags: string[]; notes: string | null;
      urls: string[]; completed: boolean; completed_at: string | null;
      removed: boolean; removed_at: string | null; created_at: string; updated_at: string;
    }>) => {
      await invoke("todos-api", wsBody({ action: "bulk_insert", todos }));
    },
    onSuccess: invalidateAll,
  });


  // When simulating time, compute virtual state without DB changes
  const { virtualTodos, virtualArchived } = useMemo(() => {
    const rawTodos = todosQuery.data || [];
    const rawArchived = archivedQuery.data?.pages?.flat() || [];

    if (!simulatedDate) {
      return { virtualTodos: rawTodos, virtualArchived: rawArchived };
    }

    const now = new Date(simulatedDate);
    const activeTodos: Todo[] = [];
    const simulatedArchived: Todo[] = [...rawArchived];

    for (const todo of rawTodos) {
      const created = new Date(todo.created_at);

      if (!todo.completed && todo.category === "next_week") {
        const endOfCreatedWeek = new Date(created);
        endOfCreatedWeek.setDate(endOfCreatedWeek.getDate() + (7 - endOfCreatedWeek.getDay()));
        endOfCreatedWeek.setHours(23, 59, 59, 999);
        if (now > endOfCreatedWeek) {
          activeTodos.push({ ...todo, category: "this_week" });
          continue;
        }
      }

      if (todo.completed && todo.completed_at) {
        const completedDate = new Date(todo.completed_at);
        let shouldArchive = false;

        if (todo.category === "today") {
          shouldArchive = now.toDateString() !== completedDate.toDateString() && now > completedDate;
        } else if (todo.category === "this_week" || todo.category === "next_week") {
          const endOfWeek = new Date(completedDate);
          endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
          endOfWeek.setHours(23, 59, 59, 999);
          shouldArchive = now > endOfWeek;
        }

        if (shouldArchive) {
          simulatedArchived.unshift({ ...todo, removed: true, removed_at: now.toISOString() });
          continue;
        }
      }

      activeTodos.push(todo);
    }

    return { virtualTodos: activeTodos, virtualArchived: simulatedArchived };
  }, [todosQuery.data, archivedQuery.data?.pages, simulatedDate]);

  const archiveCompleted = useMutation({
    mutationFn: async (ids: string[]) => {
      await invoke("todos-api", { action: "archive_completed", ids });
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ["todos"] });
      const previous = queryClient.getQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId]);
      queryClient.setQueryData<Todo[]>(["todos", user?.id, activeWorkspaceId], (old) =>
        (old ?? []).filter((t) => !ids.includes(t.id))
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(["todos", user?.id, activeWorkspaceId], context?.previous);
      toast.error(t("todos.error.archiveFailed"));
    },
    onSettled: invalidateAll,
  });

  const deleteTag = useMutation({
    mutationFn: async (tag: string) => {
      await invoke("todos-api", { action: "delete_tag", tag });
    },
    onSuccess: invalidateAll,
    onError: () => toast.error(t("todos.error.deleteTagFailed")),
  });

  return {
    todos: virtualTodos,
    archived: virtualArchived,
    archivedCount: archivedCountQuery.data ?? 0,
    isLoading: todosQuery.isLoading,
    addTodo,
    updateTodo,
    toggleComplete,
    removeTodo,
    restoreTodo,
    uploadImage,
    deleteImage,
    isDeletingImage: deleteImage.isPending,
    deletingImageId: deleteImage.variables?.id ?? null,
    permanentlyDeleteTodos,
    deleteAllTodos,
    bulkInsertTodos,
    archiveCompleted,
    deleteTag,
    fetchNextArchivedPage: archivedQuery.fetchNextPage,
    hasNextArchivedPage: !!archivedQuery.hasNextPage,
    isFetchingNextArchivedPage: archivedQuery.isFetchingNextPage,
  };
}

export async function getImageUrl(path: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("images-api", {
    body: { action: "get_url", storagePath: path },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.signedUrl;
}

export function isOverdue(todo: Todo, now?: Date): boolean {
  if (todo.completed) return false;
  if (!now) now = new Date();
  const created = new Date(todo.created_at);

  if (todo.category === "today") {
    return now.toDateString() !== created.toDateString() && now > created;
  }
  if (todo.category === "this_week") {
    const endOfWeek = new Date(created);
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
    endOfWeek.setHours(23, 59, 59, 999);
    return now > endOfWeek;
  }
  return false;
}
