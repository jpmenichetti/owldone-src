import { Todo, CATEGORY_CONFIG, TodoCategory } from "@/hooks/useTodos";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Archive, ChevronDown, RotateCcw, Trash2, Loader2 } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nContext";
import { startOfDay, subDays, isToday, isYesterday, format } from "date-fns";

const CATEGORY_LABEL_KEYS: Record<TodoCategory, string> = {
  today: "category.today",
  this_week: "category.thisWeek",
  next_week: "category.nextWeek",
  others: "category.others",
};

type Props = {
  todos: Todo[];
  totalCount?: number;
  onOpen: (todo: Todo) => void;
  onRestore?: (id: string) => void;
  onPermanentDelete?: (ids: string[]) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  autoOpen?: boolean;
  isSearching?: boolean;
};


type DateGroup = {
  label: string;
  todos: Todo[];
};

function groupByArchiveDate(todos: Todo[], t: (key: string) => string): DateGroup[] {
  const now = new Date();
  const sevenDaysAgo = startOfDay(subDays(now, 7));

  const buckets: Map<string, { label: string; todos: Todo[] }> = new Map();

  for (const todo of todos) {
    const date = new Date(todo.removed_at || todo.created_at);
    let key: string;
    let label: string;

    if (isToday(date)) {
      key = "0-today";
      label = t("archive.today");
    } else if (isYesterday(date)) {
      key = "1-yesterday";
      label = t("archive.yesterday");
    } else if (date >= sevenDaysAgo) {
      const dayKey = format(date, "yyyy-MM-dd");
      key = `2-${dayKey}`;
      label = format(date, "EEEE, MMM d");
    } else {
      key = "3-older";
      label = t("archive.older");
    }

    if (!buckets.has(key)) {
      buckets.set(key, { label, todos: [] });
    }
    buckets.get(key)!.todos.push(todo);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => group);
}

export default function ArchiveSection({ todos, totalCount, onOpen, onRestore, onPermanentDelete, onLoadMore, hasMore, isLoadingMore, autoOpen, isSearching }: Props) {
  const [open, setOpen] = useState(false);
  const manualToggleRef = useRef(false);
  const { t } = useI18n();

  useEffect(() => {
    if (autoOpen && !manualToggleRef.current) {
      setOpen(true);
    }
    if (!autoOpen) {
      if (!manualToggleRef.current) setOpen(false);
      manualToggleRef.current = false;
    }
  }, [autoOpen]);

  const handleOpenChange = (value: boolean) => {
    manualToggleRef.current = true;
    setOpen(value);
  };
  const [deleteTarget, setDeleteTarget] = useState<{ type: "single"; id: string } | { type: "period"; label: string; ids: string[] } | null>(null);

  const visibleCount = totalCount ?? todos.length;
  if (visibleCount === 0 && !isSearching) return null;


  const groups = groupByArchiveDate(todos, t);

  const handleDeleteSingle = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteTarget({ type: "single", id });
  };

  const handleDeleteByPeriod = (period: string) => {
    const now = new Date();
    let cutoff: Date;
    let label: string;

    switch (period) {
      case "1week":
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        label = t("archive.olderThan1Week");
        break;
      case "1month":
        cutoff = new Date(now);
        cutoff.setMonth(cutoff.getMonth() - 1);
        label = t("archive.olderThan1Month");
        break;
      case "3months":
        cutoff = new Date(now);
        cutoff.setMonth(cutoff.getMonth() - 3);
        label = t("archive.olderThan3Months");
        break;
      case "all":
        label = t("archive.deleteAll");
        setDeleteTarget({ type: "period", label, ids: todos.map((t) => t.id) });
        return;
      default:
        return;
    }

    const ids = todos
      .filter((todo) => {
        const archivedDate = todo.removed_at ? new Date(todo.removed_at) : new Date(todo.created_at);
        return archivedDate < cutoff;
      })
      .map((todo) => todo.id);

    if (ids.length === 0) return;
    setDeleteTarget({ type: "period", label, ids });
  };

  const confirmDelete = () => {
    if (!deleteTarget || !onPermanentDelete) return;
    if (deleteTarget.type === "single") {
      onPermanentDelete([deleteTarget.id]);
    } else {
      onPermanentDelete(deleteTarget.ids);
    }
    setDeleteTarget(null);
  };

  const deleteCount = deleteTarget
    ? deleteTarget.type === "single" ? 1 : deleteTarget.ids.length
    : 0;

  return (
    <>
      <Collapsible open={open} onOpenChange={handleOpenChange} className="rounded-xl border bg-muted/50 p-4">
        <CollapsibleTrigger className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-display text-lg font-semibold text-muted-foreground">{t("archive.title")}</h2>
            <span className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5">{totalCount ?? todos.length}</span>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-3">
          {onPermanentDelete && (
            <div className="flex items-center gap-2">
              <Select onValueChange={handleDeleteByPeriod}>
                <SelectTrigger className="h-8 w-auto min-w-[180px] text-xs">
                  <SelectValue placeholder={t("archive.deletePeriod")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1week">{t("archive.olderThan1Week")}</SelectItem>
                  <SelectItem value="1month">{t("archive.olderThan1Month")}</SelectItem>
                  <SelectItem value="3months">{t("archive.olderThan3Months")}</SelectItem>
                  <SelectItem value="all">{t("archive.deleteAll")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {groups.map((group, groupIdx) => (
            <div key={group.label}>
              {groupIdx > 0 && <Separator className="my-3" />}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-muted-foreground">{group.label}</span>
                <span className="text-[10px] text-muted-foreground/70">· {group.todos.length}</span>
              </div>
              <div className="space-y-2">
                {group.todos.map((todo) => (
                  <div
                    key={todo.id}
                    className="flex items-center gap-3 rounded-lg border bg-background/50 p-3 opacity-70 cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => onOpen(todo)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm", todo.completed && "line-through text-muted-foreground")}>{todo.text}</p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{t(CATEGORY_LABEL_KEYS[todo.category as TodoCategory] || "category.others")}</Badge>
                        <span>{t("archive.created")} {new Date(todo.created_at).toLocaleDateString()}</span>
                        {todo.removed_at && <span>• {t("archive.archived")} {new Date(todo.removed_at).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {onRestore && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("archive.restore")}
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={(e) => { e.stopPropagation(); onRestore(todo.id); }}
                          title={t("archive.restore")}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {onPermanentDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("archive.permanentDelete")}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => handleDeleteSingle(e, todo.id)}
                          title={t("archive.permanentDelete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {hasMore && onLoadMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isLoadingMore}
                onClick={onLoadMore}
              >
                {isLoadingMore ? (
                  <span className="animate-pulse">{t("archive.loadMore")}...</span>
                ) : (
                  t("archive.loadMore")
                )}
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("archive.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("archive.confirmDeleteDesc").replace("{count}", String(deleteCount))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("backup.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("archive.confirmDeleteBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
