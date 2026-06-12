import type { Todo, TodoCategory } from "@/hooks/useTodos";

/**
 * Returns the local end-of-week (Sunday 23:59:59.999) for the week containing `date`.
 * Week is Monday → Sunday. If `date` is already Sunday, returns that same Sunday EOD
 * (NOT next Sunday). This fixes the previous `7 - getDay()` bug that delayed archiving
 * by a full week for items completed/created on Sunday.
 */
export function endOfWeek(date: Date): Date {
  const eow = new Date(date);
  const day = eow.getDay(); // Sun=0, Mon=1 ... Sat=6
  const daysUntilSunday = (7 - day) % 7; // Sun→0, Mon→6, ... Sat→1
  eow.setDate(eow.getDate() + daysUntilSunday);
  eow.setHours(23, 59, 59, 999);
  return eow;
}

/** True iff `now` is on a different calendar day than `then` AND strictly later. */
export function isAfterDay(now: Date, then: Date): boolean {
  return now.toDateString() !== then.toDateString() && now > then;
}

export interface TransitionPlan {
  idsToArchive: string[];
  idsToMoveToThisWeek: string[];
}

/**
 * Pure lifecycle rule evaluator.
 *
 * Rules:
 *   - completed "today"            → archive the following calendar day
 *   - completed "this_week"        → archive after Sunday 23:59 of completed week
 *   - completed "next_week"        → archive after Sunday 23:59 of completed week
 *   - uncompleted "next_week"      → move to "this_week" after Sunday 23:59 of created week
 *   - "others" / uncompleted today / uncompleted this_week → never auto-transition
 */
export function computeTransitions(todos: Todo[], now: Date): TransitionPlan {
  const idsToArchive: string[] = [];
  const idsToMoveToThisWeek: string[] = [];

  for (const todo of todos) {
    const category = todo.category as TodoCategory;

    // next_week → this_week rollover for uncompleted items
    if (!todo.completed && category === "next_week") {
      const created = new Date(todo.created_at);
      if (now > endOfWeek(created)) {
        idsToMoveToThisWeek.push(todo.id);
      }
      continue;
    }

    if (!todo.completed || !todo.completed_at) continue;
    const completedDate = new Date(todo.completed_at);

    if (category === "today") {
      if (isAfterDay(now, completedDate)) idsToArchive.push(todo.id);
    } else if (category === "this_week" || category === "next_week") {
      if (now > endOfWeek(completedDate)) idsToArchive.push(todo.id);
    }
    // "others" is never auto-archived
  }

  return { idsToArchive, idsToMoveToThisWeek };
}
