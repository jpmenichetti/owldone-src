import { AlertTriangle, Tag, X, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { tagColor } from "@/lib/tagColors";
import { useI18n } from "@/i18n/I18nContext";

interface FilterBarProps {
  showOverdue: boolean;
  selectedTags: string[];
  allTags: string[];
  hasActiveFilters: boolean;
  searchText: string;
  isSaving?: boolean;
  onSearchChange: (value: string) => void;
  onToggleOverdue: () => void;
  onToggleTag: (tag: string) => void;
  onClear: () => void;
}

const FilterBar = ({
  showOverdue,
  selectedTags,
  allTags,
  hasActiveFilters,
  searchText,
  isSaving,
  onSearchChange,
  onToggleOverdue,
  onToggleTag,
  onClear,
}: FilterBarProps) => {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-56">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
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
            <Button variant="outline" size="sm" className="gap-1.5">
              <Tag className="h-3.5 w-3.5" />
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
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => onToggleTag(tag)}
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer ${
                    selectedTags.includes(tag)
                      ? `${tagColor(tag)} ring-2 ring-ring ring-offset-1`
                      : `${tagColor(tag)} opacity-50 hover:opacity-80`
                  }`}
                >
                  {tag}
                </button>
              ))}
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
    </div>
  );
};

export default FilterBar;
