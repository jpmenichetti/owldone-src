import type { Todo } from "@/hooks/useTodos";

const CSV_HEADERS = [
  "text",
  "category",
  "tags",
  "notes",
  "urls",
  "completed",
  "completed_at",
  "removed",
  "removed_at",
  "created_at",
  "updated_at",
];

function escapeCsvValue(value: string | null | undefined): string {
  if (value == null) return "";
  let str = String(value);
  // Neutralise spreadsheet formula injection by prefixing a tab to risky values.
  if (/^[=+\-@\t\r]/.test(str)) str = "\t" + str;
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r") || str.includes("\t")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportTodosCsv(todos: Todo[]): void {
  const rows: string[] = [CSV_HEADERS.join(",")];

  for (const todo of todos) {
    const row = [
      escapeCsvValue(todo.text),
      escapeCsvValue(todo.category),
      escapeCsvValue((todo.tags || []).join(";")),
      escapeCsvValue(todo.notes),
      escapeCsvValue((todo.urls || []).join(";")),
      escapeCsvValue(String(todo.completed)),
      escapeCsvValue(todo.completed_at),
      escapeCsvValue(String(todo.removed)),
      escapeCsvValue(todo.removed_at),
      escapeCsvValue(todo.created_at),
      escapeCsvValue(todo.updated_at),
    ];
    rows.push(row.join(","));
  }

  const csvContent = rows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `owldone-backup-${date}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
