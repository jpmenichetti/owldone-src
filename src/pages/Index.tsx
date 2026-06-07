import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTodos, Todo, TodoCategory, isOverdue } from "@/hooks/useTodos";
import { useI18n } from "@/i18n/I18nContext";
import { useSimulatedTime } from "@/hooks/useSimulatedTime";
import { useFilters } from "@/hooks/useFilters";
import LoginPage from "@/components/LoginPage";
import Navbar from "@/components/Navbar";
import FilterBar from "@/components/FilterBar";
import CategorySection from "@/components/CategorySection";
import ArchiveSection from "@/components/ArchiveSection";
import TodoDetailDialog from "@/components/TodoDetailDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, TouchSensor, useSensor, useSensors, defaultDropAnimationSideEffects } from "@dnd-kit/core";
import TodoCard from "@/components/TodoCard";
import OnboardingDialog from "@/components/OnboardingDialog";
import WeeklyReportSection from "@/components/WeeklyReportSection";
import WorkspaceTabs from "@/components/WorkspaceTabs";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useTrackGoogleLanding } from "@/hooks/useTrackGoogleLanding";

const CATEGORIES: TodoCategory[] = ["today", "this_week", "next_week", "others"];

const Index = () => {
  useTrackGoogleLanding();
  const { user, loading: authLoading } = useAuth();
  const { showOverdue, selectedTags, toggleOverdue, toggleTag, clearFilters, hasActiveFilters, savingSource, searchText, setSearchText, debouncedSearchText } = useFilters();
  const { todos, archived, archivedCount, isLoading, addTodo, updateTodo, toggleComplete, removeTodo, restoreTodo, permanentlyDeleteTodos, uploadImage, deleteImage, isDeletingImage, deletingImageId, archiveCompleted, deleteTag, fetchNextArchivedPage, hasNextArchivedPage, isFetchingNextArchivedPage } = useTodos(debouncedSearchText);
  const { t } = useI18n();
  const { getNow } = useSimulatedTime();
  const { showOnboarding, completeOnboarding } = useOnboarding();
  const { hasFeature, loading: featureAccessLoading } = useFeatureAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const todoIdParam = searchParams.get("todo");
  const dialogReadOnly = searchParams.get("ro") === "1";
  const [activeDragTodo, setActiveDragTodo] = useState<Todo | null>(null);

  const allTags = useMemo(
    () => Array.from(new Set([...todos, ...archived].flatMap((t) => t.tags || []))),
    [todos, archived]
  );

  const filteredTodos = useMemo(() => {
    let result = todos;
    if (showOverdue) result = result.filter((t) => isOverdue(t, getNow()));
    if (selectedTags.length > 0) result = result.filter((t) => selectedTags.every((tag) => (t.tags || []).includes(tag)));
    if (debouncedSearchText) {
      const lower = debouncedSearchText.toLowerCase();
      result = result.filter((t) =>
        t.text.toLowerCase().includes(lower) ||
        (t.notes || "").toLowerCase().includes(lower) ||
        (t.urls || []).join(" ").toLowerCase().includes(lower)
      );
    }
    return result;
  }, [todos, showOverdue, selectedTags, getNow, debouncedSearchText]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const setTodoParam = useCallback(
    (id: string | null, readOnly = false, replace = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) {
            next.set("todo", id);
            if (readOnly) next.set("ro", "1");
            else next.delete("ro");
          } else {
            next.delete("todo");
            next.delete("ro");
          }
          return next;
        },
        { replace }
      );
    },
    [setSearchParams]
  );

  // Remember the optimistic todo signature so we can swap temp→real IDs in the URL
  const pendingOpenRef = useRef<{ id: string; text: string; category: TodoCategory } | null>(null);

  const openTodo = useCallback(
    (todo: Todo, readOnly = false) => {
      pendingOpenRef.current = { id: todo.id, text: todo.text, category: todo.category as TodoCategory };
      setTodoParam(todo.id, readOnly);
    },
    [setTodoParam]
  );

  const handleAdd = useCallback((text: string, category: TodoCategory) => {
    addTodo.mutate({ text, category, tempId: crypto.randomUUID() });
  }, [addTodo]);

  const handleToggle = useCallback((id: string, completed: boolean) => {
    toggleComplete.mutate({ id, completed });
  }, [toggleComplete]);

  const handleRemove = useCallback((id: string) => {
    removeTodo.mutate(id);
  }, [removeTodo]);

  const handleDragStart = (event: DragStartEvent) => {
    const todo = todos.find((t) => t.id === event.active.id);
    setActiveDragTodo(todo || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragTodo(null);
    const { active, over } = event;
    if (!over) return;
    const todoId = active.id as string;
    const newCategory = over.id as TodoCategory;
    const todo = todos.find((t) => t.id === todoId);
    if (!todo || todo.category === newCategory) return;

    const updates: Record<string, unknown> = { category: newCategory };
    if (newCategory !== "others") {
      updates.created_at = new Date().toISOString();
    }
    updateTodo.mutate({ id: todoId, ...updates } as any);
  };

  // Resolve URL todo id to a live todo from current data
  const liveTodo = useMemo(() => {
    if (!todoIdParam) return null;
    return [...todos, ...archived].find((t) => t.id === todoIdParam) || null;
  }, [todoIdParam, todos, archived]);

  // Clear ?todo= if it points to an unknown id (e.g. after delete or bad link).
  // Skip while a freshly-opened optimistic todo is still waiting for its real id.
  useEffect(() => {
    if (!user || !todoIdParam || isLoading) return;
    const exists = todos.some((t) => t.id === todoIdParam) || archived.some((t) => t.id === todoIdParam);
    if (exists) return;
    if (pendingOpenRef.current?.id === todoIdParam) return;
    setTodoParam(null, false, true);
  }, [user, todoIdParam, todos, archived, isLoading, setTodoParam]);

  // When an optimistic temp id is replaced by the real server id, swap the URL param
  useEffect(() => {
    const pending = pendingOpenRef.current;
    if (!pending || !todoIdParam || pending.id !== todoIdParam) return;
    if (todos.some((t) => t.id === todoIdParam)) return;
    const match = todos.find((t) => t.text === pending.text && t.category === pending.category);
    if (match) {
      pendingOpenRef.current = { ...pending, id: match.id };
      setTodoParam(match.id, dialogReadOnly, true);
    }
  }, [todos, todoIdParam, dialogReadOnly, setTodoParam]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container max-w-4xl py-6 space-y-6">
        {(() => {
          const completedIds = filteredTodos.filter((t) => t.completed).map((t) => t.id);
          return (
            <FilterBar
              showOverdue={showOverdue}
              selectedTags={selectedTags}
              allTags={allTags}
              hasActiveFilters={hasActiveFilters}
              searchText={searchText}
              isSaving={savingSource === "overdue"}
              isSavingTags={savingSource === "tag"}
              onSearchChange={setSearchText}
              onToggleOverdue={toggleOverdue}
              onToggleTag={toggleTag}
              onClear={clearFilters}
              deletingTag={deleteTag.isPending ? (deleteTag.variables as string) : null}
              onDeleteTag={(tag) => {
                deleteTag.mutate(tag, {
                  onSuccess: () => {
                    if (selectedTags.includes(tag)) toggleTag(tag);
                    toast(t("filter.tagDeleted").replace("{tag}", tag));
                  },
                });
              }}
              completedCount={completedIds.length}
              isArchiving={archiveCompleted.isPending}
              onArchive={() => {
                const count = completedIds.length;
                archiveCompleted.mutate(completedIds, {
                  onSuccess: () => toast(t("todo.archivedCount").replace("{count}", String(count))),
                });
              }}
            />
          );
        })()}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {CATEGORIES.map((cat) => (
                  <CategorySection
                    key={cat}
                    category={cat}
                    todos={filteredTodos}
                    onAdd={handleAdd}
                    onToggle={handleToggle}
                    onRemove={handleRemove}
                    onOpen={openTodo}
                    isAdding={addTodo.isPending}
                  />
                ))}
              </div>
              <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0" } } }) }}>
                {activeDragTodo ? (
                  <div className="w-[340px] opacity-90 rotate-1 scale-[1.02]">
                    <TodoCard
                      todo={activeDragTodo}
                      onToggle={() => {}}
                      onRemove={() => {}}
                      onOpen={() => {}}
                      readOnly
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>

            <WeeklyReportSection />

            <ArchiveSection
              todos={archived}
              totalCount={archivedCount}
              onOpen={(todo) => openTodo(todo, true)}
              onRestore={(id) => restoreTodo.mutate(id)}
              onPermanentDelete={(ids) => permanentlyDeleteTodos.mutate(ids)}
              onLoadMore={() => fetchNextArchivedPage()}
              hasMore={hasNextArchivedPage}
              isLoadingMore={isFetchingNextArchivedPage}
              autoOpen={!!debouncedSearchText && archivedCount > 0}
            />
          </>
        )}
      </main>

      <OnboardingDialog
        open={showOnboarding}
        onComplete={() => completeOnboarding.mutate()}
      />

      <TodoDetailDialog
        todo={liveTodo}
        open={!!liveTodo && !featureAccessLoading}
        onClose={() => setTodoParam(null)}
        onUpdate={(id, updates) => updateTodo.mutate({ id, ...updates })}
        onUploadImage={(todoId, file) => uploadImage.mutate({ todoId, file })}
        onDeleteImage={(id, storagePath) => deleteImage.mutate({ id, storagePath })}
        isUploading={uploadImage.isPending}
        isDeletingImage={isDeletingImage}
        deletingImageId={deletingImageId}
        readOnly={dialogReadOnly}
        allTags={allTags}
        recurrenceEnabled={hasFeature("recurrence")}
        recurrenceResolved={!featureAccessLoading}
      />
    </div>
  );
};

export default Index;
