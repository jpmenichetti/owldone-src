import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeTransitionsUTC,
  endOfWeekUTC,
  isAfterDayUTC,
} from "./index.ts";

// All dates below are UTC to keep the suite portable across runners.

Deno.test("endOfWeekUTC: Sunday returns same Sunday EOD", () => {
  // 2026-06-14 is Sunday UTC
  const sun = new Date("2026-06-14T08:00:00Z");
  const eow = endOfWeekUTC(sun);
  assertEquals(eow.getUTCDate(), 14);
  assertEquals(eow.getUTCHours(), 23);
  assertEquals(eow.getUTCMinutes(), 59);
});

Deno.test("endOfWeekUTC: Monday rolls to following Sunday", () => {
  const mon = new Date("2026-06-08T00:00:00Z"); // Mon
  assertEquals(endOfWeekUTC(mon).getUTCDate(), 14);
});

Deno.test("isAfterDayUTC: next UTC day is after", () => {
  assertEquals(
    isAfterDayUTC(new Date("2026-06-13T00:01:00Z"), new Date("2026-06-12T23:59:00Z")),
    true,
  );
});

Deno.test("isAfterDayUTC: same UTC day is not after", () => {
  assertEquals(
    isAfterDayUTC(new Date("2026-06-12T23:59:00Z"), new Date("2026-06-12T00:01:00Z")),
    false,
  );
});

Deno.test("computeTransitionsUTC: completed 'today' archived next UTC day", () => {
  const todo = {
    id: "t1",
    category: "today",
    completed: true,
    completed_at: "2026-06-12T22:00:00Z",
    created_at: "2026-06-12T08:00:00Z",
  };
  const plan = computeTransitionsUTC([todo], new Date("2026-06-13T01:00:00Z"));
  assertEquals(plan.idsToArchive, ["t1"]);
  assertEquals(plan.idsToMoveToThisWeek, []);
});

Deno.test("computeTransitionsUTC: completed 'today' NOT archived same UTC day", () => {
  const todo = {
    id: "t1",
    category: "today",
    completed: true,
    completed_at: "2026-06-12T08:00:00Z",
    created_at: "2026-06-12T08:00:00Z",
  };
  const plan = computeTransitionsUTC([todo], new Date("2026-06-12T23:59:00Z"));
  assertEquals(plan.idsToArchive, []);
});

Deno.test("computeTransitionsUTC: completed 'this_week' archived after Sunday UTC EOD", () => {
  const todo = {
    id: "t1",
    category: "this_week",
    completed: true,
    completed_at: "2026-06-10T12:00:00Z", // Wed
    created_at: "2026-06-08T08:00:00Z",
  };
  // Monday next week (UTC)
  const plan = computeTransitionsUTC([todo], new Date("2026-06-15T00:05:00Z"));
  assertEquals(plan.idsToArchive, ["t1"]);
});

Deno.test("computeTransitionsUTC: 'this_week' not archived mid-week", () => {
  const todo = {
    id: "t1",
    category: "this_week",
    completed: true,
    completed_at: "2026-06-10T12:00:00Z",
    created_at: "2026-06-08T08:00:00Z",
  };
  const plan = computeTransitionsUTC([todo], new Date("2026-06-12T12:00:00Z"));
  assertEquals(plan.idsToArchive, []);
});

Deno.test("computeTransitionsUTC: uncompleted 'next_week' rolls to this_week after Sunday", () => {
  const todo = {
    id: "n1",
    category: "next_week",
    completed: false,
    completed_at: null,
    created_at: "2026-06-08T08:00:00Z", // Mon
  };
  const plan = computeTransitionsUTC([todo], new Date("2026-06-15T00:05:00Z"));
  assertEquals(plan.idsToMoveToThisWeek, ["n1"]);
  assertEquals(plan.idsToArchive, []);
});

Deno.test("computeTransitionsUTC: 'others' is never auto-transitioned", () => {
  const todo = {
    id: "o1",
    category: "others",
    completed: true,
    completed_at: "2020-01-01T00:00:00Z",
    created_at: "2020-01-01T00:00:00Z",
  };
  const plan = computeTransitionsUTC([todo], new Date("2030-01-01T00:00:00Z"));
  assertEquals(plan.idsToArchive, []);
  assertEquals(plan.idsToMoveToThisWeek, []);
});

Deno.test("computeTransitionsUTC: handles many todos across workspaces (ids only)", () => {
  const completedAt = "2026-06-10T12:00:00Z";
  const createdAt = "2026-06-08T08:00:00Z";
  const todos = Array.from({ length: 50 }, (_, i) => ({
    id: `t${i}`,
    category: i % 2 === 0 ? "today" : "this_week",
    completed: true,
    completed_at: i % 2 === 0 ? "2026-06-12T08:00:00Z" : completedAt,
    created_at: createdAt,
  }));
  const plan = computeTransitionsUTC(todos, new Date("2026-06-15T01:00:00Z"));
  // All 50 should archive (today completed before, this_week after EOW).
  assertEquals(plan.idsToArchive.length, 50);
});
