import { useState } from "react";
import { AlertTriangle, Tag, X, Search, Loader2, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { tagColor } from "@/lib/tagColors";
import { useI18n } from "@/i18n/I18nContext";

interface FilterBarProps {
  showOverdue: boolean;
  selectedTags: string[];
  allTags: string[];
  hasActiveFilters: boolean;
  searchText: string;
  isSaving?: boolean;
  isSavingTags?: boolean;
  completedCount?: number;
  isArchiving?: boolean;
  deletingTag?: string | null;
  onArchive?: () => void;
  onSearchChange: (value: string) => void;
  onToggleOverdue: () => void;
  onToggleTag: (tag: string) => void;
  onDeleteTag?: (tag: string) => void;
  onClear: () => void;
}

const FilterBar = ({
  showOverdue,
  selectedTags,
  allTags,
  hasActiveFilters,
  searchText,
  isSaving,
  isSavingTags,
  completedCount = 0,
  isArchiving,
  deletingTag,
  onArchive,
  onSearchChange,
  onToggleOverdue,
  onToggleTag,
  onDeleteTag,
  onClear,
}: FilterBarProps) => {
  const { t } = useI18n();
  const [tagToDelete, setTagToDelete] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-56">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          type="search"
          aria-label={t("filter.search")}
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("filter.search")}
          className="pl-8 h-9 text-sm"
        />
      </div>
      <Button
        variant={showOverdue ? "default" : "outline"}
        size="sm"
        onClick={onToggleOverdue}
        disabled={isSaving}
        className="gap-1.5"
      >
        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        {t("filter.overdue")}
      </Button>

      {allTags.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={isSavingTags}>
              {isSavingTags ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
              {t("filter.tags")}
              {selectedTags.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {selectedTags.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <p className="text-xs font-medium text-muted-foreground mb-2">{t("filter.selectTags")}</p>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const selected = selectedTags.includes(tag);
                const isDeleting = deletingTag === tag;
                return (
                  <span
                    key={tag}
                    className={`inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 py-0.5 text-xs font-medium transition-all ${
                      selected
                        ? `${tagColor(tag)} ring-2 ring-ring ring-offset-1`
                        : `${tagColor(tag)} opacity-50 hover:opacity-80`
                    } ${isDeleting ? "opacity-40" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleTag(tag)}
                      disabled={isDeleting}
                      className="cursor-pointer focus:outline-none"
                    >
                      {tag}
                    </button>
                    {onDeleteTag && (
                      <button
                        type="button"
                        aria-label={t("filter.deleteTag").replace("{tag}", tag)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setTagToDelete(tag);
                        }}
                        disabled={isDeleting}
                        className="ml-0.5 inline-flex items-center justify-center rounded-full hover:bg-background/40 p-0.5 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {selectedTags.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="gap-1 cursor-pointer hover:bg-destructive/10"
          onClick={() => onToggleTag(tag)}
        >
          {tag}
          <X className="h-3 w-3" />
        </Badge>
      ))}

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
          {t("filter.clear")}
        </Button>
      )}

      {completedCount > 0 && onArchive && (
        <Button
          variant="outline"
          size="sm"
          disabled={isArchiving}
          onClick={onArchive}
          className="sm:ml-auto gap-1.5"
        >
          <Archive className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("todo.archiveCompleted")}</span>
        </Button>
      )}

      <AlertDialog open={!!tagToDelete} onOpenChange={(open) => !open && setTagToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("filter.deleteTagConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("filter.deleteTagConfirmBody").replace("{tag}", tagToDelete ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (tagToDelete && onDeleteTag) onDeleteTag(tagToDelete);
                setTagToDelete(null);
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FilterBar;
