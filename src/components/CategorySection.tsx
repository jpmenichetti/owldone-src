import { Todo, TodoCategory, CATEGORY_CONFIG } from "@/hooks/useTodos";
import AddTodo from "./AddTodo";
import TodoCard from "./TodoCard";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useDroppable } from "@dnd-kit/core";
import { useI18n } from "@/i18n/I18nContext";

const CATEGORY_INFO_KEYS: Record<TodoCategory, string> = {
  today: "category.info.today",
  this_week: "category.info.thisWeek",
  next_week: "category.info.nextWeek",
  others: "category.info.others",
};

const CATEGORY_LABEL_KEYS: Record<TodoCategory, string> = {
  today: "category.today",
  this_week: "category.thisWeek",
  next_week: "category.nextWeek",
  others: "category.others",
};

type Props = {
  category: TodoCategory;
  todos: Todo[];
  onAdd: (text: string, category: TodoCategory) => void;
  onToggle: (id: string, completed: boolean) => void;
  onRemove: (id: string) => void;
  onOpen: (todo: Todo) => void;
  isAdding: boolean;
};

export default function CategorySection({ category, todos, onAdd, onToggle, onRemove, onOpen, isAdding }: Props) {
  const config = CATEGORY_CONFIG[category];
  const categoryTodos = todos.filter((t) => t.category === category);
  const { setNodeRef, isOver } = useDroppable({ id: category });
  const { t } = useI18n();
  const label = t(CATEGORY_LABEL_KEYS[category]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-xl border-2 p-4 space-y-3 transition-colors",
        config.bgClass,
        isOver && "ring-2 ring-primary/40 border-primary/40",
      )}
      style={{ borderColor: isOver ? undefined : `hsl(var(--category-${category === "this_week" ? "week" : category === "next_week" ? "next" : category}) / 0.3)` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">{config.emoji}</span>
        <h2 className={cn("font-display text-lg font-semibold", config.colorClass)}>
          {label}
        </h2>
        <span className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5">
          {categoryTodos.length}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`About ${label} category`} className="h-6 w-6 text-muted-foreground hover:text-foreground">
              <Info className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 text-sm" side="top">
            <p className="font-medium mb-1">{label} {t("category.rules")}</p>
            <p className="text-muted-foreground text-xs">{t(CATEGORY_INFO_KEYS[category])}</p>
          </PopoverContent>
        </Popover>
      </div>

      <AddTodo category={category} onAdd={onAdd} isPending={isAdding} />

      <div className="space-y-2">
        {categoryTodos.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">{t("category.noTasks")}</p>
        ) : (
          categoryTodos.map((todo) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              onToggle={onToggle}
              onRemove={onRemove}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}
