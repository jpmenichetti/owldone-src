import { memo } from "react";
import { Todo, TodoCategory, CATEGORY_CONFIG, isOverdue } from "@/hooks/useTodos";
import { useSimulatedTime } from "@/hooks/useSimulatedTime";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, FileText, Image, Link2, ChevronRight, GripVertical, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { playCompletionSound } from "@/lib/sounds";
import { useDraggable } from "@dnd-kit/core";
import { tagColor } from "@/lib/tagColors";
import { useI18n } from "@/i18n/I18nContext";

type Props = {
  todo: Todo;
  onToggle: (id: string, completed: boolean) => void;
  onRemove: (id: string) => void;
  onOpen: (todo: Todo) => void;
  readOnly?: boolean;
};

const TodoCard = memo(function TodoCard({ todo, onToggle, onRemove, onOpen, readOnly }: Props) {
  const { getNow } = useSimulatedTime();
  const overdue = isOverdue(todo, getNow());
  const config = CATEGORY_CONFIG[todo.category as TodoCategory];
  const hasAttachments = todo.notes || (todo.urls && todo.urls.length > 0) || (todo.images && todo.images.length > 0);
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: todo.id,
    disabled: readOnly,
  });
  const { t } = useI18n();

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div
      style={style}
      className={cn(
        "group relative flex items-start gap-3 rounded-lg border p-3 transition-all hover:shadow-sm cursor-pointer bg-background",
        todo.completed && "opacity-60",
        overdue && "border-destructive/50 bg-destructive/5",
        isDragging && "opacity-0 pointer-events-none",
      )}
      onClick={() => !isDragging && onOpen(todo)}
    >
      {!readOnly && (
        <div
          ref={setDragRef}
          className="pt-1 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground touch-none"
          onClick={(e) => e.stopPropagation()}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}

      {!readOnly && (
        <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            aria-label={`Mark "${todo.text}" as ${todo.completed ? "incomplete" : "completed"}`}
            checked={todo.completed}
            onCheckedChange={(checked) => {
              if (checked) playCompletionSound();
              onToggle(todo.id, !!checked);
            }}
          />
        </div>
      )}

      <div className="flex-1 min-w-0 space-y-1.5">
        <p className={cn("text-sm font-medium leading-tight", todo.completed && "line-through text-muted-foreground")}>
          {todo.text}
        </p>

        <div className="flex flex-wrap gap-1">
          {todo.tags?.map((tag) => (
            <span key={tag} className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", tagColor(tag))}>
              {tag}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{new Date(todo.created_at).toLocaleDateString()}</span>
          {todo.recurrence && <Repeat className="h-3 w-3 text-primary" />}
          {overdue && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{t("todo.overdue")}</Badge>}
          {hasAttachments && (
            <div className="flex items-center gap-1 text-muted-foreground/70">
              {todo.notes && <FileText className="h-3 w-3" />}
              {todo.images && todo.images.length > 0 && <Image className="h-3 w-3" />}
              {todo.urls && todo.urls.length > 0 && <Link2 className="h-3 w-3" />}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        {!readOnly && (
          <Button aria-label={`Delete task: ${todo.text}`} variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); onRemove(todo.id); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button aria-label={`Open task details: ${todo.text}`} variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={(e) => { e.stopPropagation(); onOpen(todo); }}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});

export default TodoCard;
