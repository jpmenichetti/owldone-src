import { describe, it, expect } from "vitest";
import { computeTransitions, endOfWeek, isAfterDay } from "./lifecycle";
import type { Todo } from "@/hooks/useTodos";

function todo(partial: Partial<Todo> & { id: string; category: Todo["category"]; created_at: string }): Todo {
  return {
    id: partial.id,
    user_id: "u1",
    workspace_id: "ws1",
    text: "t",
    category: partial.category,
    completed: false,
    completed_at: null,
    removed: false,
    removed_at: null,
    created_at: partial.created_at,
    updated_at: partial.created_at,
    notes: null,
    tags: null,
    urls: null,
    recurrence: null,
    images: [],
    ...partial,
  } as Todo;
}

describe("endOfWeek", () => {
  it("returns the SAME Sunday 23:59 when date is already Sunday (regression: was +7 days)", () => {
    const sunday = new Date(2026, 5, 14, 10, 0, 0); // June 14 2026 is Sunday
    const eow = endOfWeek(sunday);
    expect(eow.getDate()).toBe(14);
    expect(eow.getMonth()).toBe(5);
    expect(eow.getHours()).toBe(23);
    expect(eow.getMinutes()).toBe(59);
  });

  it("returns upcoming Sunday for Monday", () => {
    const mon = new Date(2026, 5, 8, 10, 0, 0); // Mon June 8
    expect(endOfWeek(mon).getDate()).toBe(14);
  });

  it("returns next-day Sunday for Saturday", () => {
    const sat = new Date(2026, 5, 13, 10, 0, 0); // Sat June 13
    expect(endOfWeek(sat).getDate()).toBe(14);
  });
});

describe("isAfterDay", () => {
  it("true the next calendar day", () => {
    expect(isAfterDay(new Date(2026, 5, 13, 0, 1), new Date(2026, 5, 12, 23, 59))).toBe(true);
  });
  it("false within the same day", () => {
    expect(isAfterDay(new Date(2026, 5, 12, 23, 59), new Date(2026, 5, 12, 0, 1))).toBe(false);
  });
});

describe("computeTransitions", () => {
  it("archives a completed 'today' task the next day", () => {
    const t = todo({
      id: "a", category: "today",
      created_at: "2026-06-12T08:00:00Z",
      completed: true, completed_at: new Date(2026, 5, 12, 23, 0).toISOString(),
    });
    const plan = computeTransitions([t], new Date(2026, 5, 13, 0, 5));
    expect(plan.idsToArchive).toEqual(["a"]);
  });

  it("does NOT archive a completed 'today' task the same day", () => {
    const t = todo({
      id: "a", category: "today",
      created_at: "2026-06-12T08:00:00Z",
      completed: true, completed_at: new Date(2026, 5, 12, 9, 0).toISOString(),
    });
    const plan = computeTransitions([t], new Date(2026, 5, 12, 23, 59));
    expect(plan.idsToArchive).toEqual([]);
  });

  it("archives a Sunday-completed 'this_week' task the following Monday (regression)", () => {
    const completedSunday = new Date(2026, 5, 14, 22, 0); // Sun June 14
    const t = todo({
      id: "a", category: "this_week",
      created_at: "2026-06-08T08:00:00Z",
      completed: true, completed_at: completedSunday.toISOString(),
    });
    // Monday June 15 at 00:05 — before fix, this would NOT archive until June 21.
    const plan = computeTransitions([t], new Date(2026, 5, 15, 0, 5));
    expect(plan.idsToArchive).toEqual(["a"]);
  });

  it("does NOT archive a 'this_week' task mid-week", () => {
    const t = todo({
      id: "a", category: "this_week",
      created_at: "2026-06-08T08:00:00Z",
      completed: true, completed_at: new Date(2026, 5, 10, 9, 0).toISOString(),
    });
    const plan = computeTransitions([t], new Date(2026, 5, 12, 12, 0)); // Fri
    expect(plan.idsToArchive).toEqual([]);
  });

  it("moves uncompleted 'next_week' to 'this_week' after end of its created week", () => {
    const t = todo({
      id: "a", category: "next_week",
      created_at: new Date(2026, 5, 8, 10, 0).toISOString(), // Mon June 8
    });
    const plan = computeTransitions([t], new Date(2026, 5, 15, 0, 5)); // Mon June 15
    expect(plan.idsToMoveToThisWeek).toEqual(["a"]);
  });

  it("uncompleted 'next_week' created on Sunday rolls over the very next day (regression)", () => {
    const t = todo({
      id: "a", category: "next_week",
      created_at: new Date(2026, 5, 14, 10, 0).toISOString(), // Sun June 14
    });
    // Before fix, end-of-created-week was June 21; after fix it is June 14 EOD.
    const plan = computeTransitions([t], new Date(2026, 5, 15, 0, 5));
    expect(plan.idsToMoveToThisWeek).toEqual(["a"]);
  });

  it("does not auto-transition 'others' category", () => {
    const t = todo({
      id: "a", category: "others",
      created_at: "2020-01-01T00:00:00Z",
      completed: true, completed_at: "2020-01-02T00:00:00Z",
    });
    expect(computeTransitions([t], new Date()).idsToArchive).toEqual([]);
  });

  it("ignores completed-but-no-timestamp rows", () => {
    const t = todo({
      id: "a", category: "today",
      created_at: "2026-06-12T08:00:00Z",
      completed: true, completed_at: null,
    });
    expect(computeTransitions([t], new Date(2026, 5, 20)).idsToArchive).toEqual([]);
  });
});
