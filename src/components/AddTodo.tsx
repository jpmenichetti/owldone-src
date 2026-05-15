import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { TodoCategory } from "@/hooks/useTodos";
import { useI18n } from "@/i18n/I18nContext";

const CATEGORY_LABEL_KEYS: Record<TodoCategory, string> = {
  today: "category.today",
  this_week: "category.thisWeek",
  next_week: "category.nextWeek",
  others: "category.others",
};

type Props = {
  category: TodoCategory;
  onAdd: (text: string, category: TodoCategory) => void;
  isPending: boolean;
};

export default function AddTodo({ category, onAdd, isPending }: Props) {
  const [text, setText] = useState("");
  const { t } = useI18n();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim(), category);
    setText("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        aria-label={t("addTodo.placeholder", { category: t(CATEGORY_LABEL_KEYS[category]) })}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("addTodo.placeholder", { category: t(CATEGORY_LABEL_KEYS[category]) })}
        className="flex-1"
      />
      <Button
        type="submit"
        size="icon"
        aria-label={`Add task to ${t(CATEGORY_LABEL_KEYS[category])}`}
        disabled={!text.trim()}
        className="shrink-0"
        style={{ backgroundColor: `hsl(var(--category-${category === "this_week" ? "week" : category === "next_week" ? "next" : category}))` }}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </form>
  );
}
