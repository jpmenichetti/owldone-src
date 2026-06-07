import { describe, it, expect } from "vitest";
import { planRestore, type BackupWorkspace } from "./backupRestore";
import type { ImportedTodo } from "./importCsv";

function makeRow(overrides: Partial<ImportedTodo> = {}): ImportedTodo {
  return {
    text: "t",
    category: "today",
    tags: [],
    notes: null,
    urls: [],
    completed: false,
    completed_at: null,
    removed: false,
    removed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    workspace_name: null,
    ...overrides,
  };
}

const DEFAULT_WS: BackupWorkspace = { id: "ws-default", name: "My tasks", is_default: true };

describe("planRestore", () => {
  it("routes rows without a workspace to the default workspace", () => {
    const rows = [makeRow({ text: "a" }), makeRow({ text: "b" })];
    const plan = planRestore(rows, [DEFAULT_WS]);
    expect(plan.workspacesToCreate).toEqual([]);
    const groups = plan.buildGroups([DEFAULT_WS], DEFAULT_WS.id);
    expect([...groups.keys()]).toEqual([DEFAULT_WS.id]);
    expect(groups.get(DEFAULT_WS.id)).toHaveLength(2);
  });

  it("matches existing workspaces by name (case-insensitive, trimmed)", () => {
    const work: BackupWorkspace = { id: "ws-work", name: "Work", is_default: false };
    const rows = [
      makeRow({ text: "a", workspace_name: " work " }),
      makeRow({ text: "b", workspace_name: "WORK" }),
    ];
    const plan = planRestore(rows, [DEFAULT_WS, work]);
    expect(plan.workspacesToCreate).toEqual([]);
    const groups = plan.buildGroups([DEFAULT_WS, work], DEFAULT_WS.id);
    expect(groups.get("ws-work")).toHaveLength(2);
    expect(groups.has(DEFAULT_WS.id)).toBe(false);
  });

  it("requests creation of workspaces that don't yet exist (deduped)", () => {
    const rows = [
      makeRow({ workspace_name: "Personal" }),
      makeRow({ workspace_name: "personal" }), // duplicate, different casing
      makeRow({ workspace_name: "Side project" }),
      makeRow({ workspace_name: null }),
    ];
    const plan = planRestore(rows, [DEFAULT_WS]);
    expect(plan.workspacesToCreate).toEqual(["Personal", "Side project"]);
  });

  it("groups rows by their resolved workspace once created", () => {
    const rows = [
      makeRow({ text: "default-1" }),
      makeRow({ text: "work-1", workspace_name: "Work" }),
      makeRow({ text: "work-2", workspace_name: "work" }),
      makeRow({ text: "personal-1", workspace_name: "Personal" }),
    ];
    const plan = planRestore(rows, [DEFAULT_WS]);
    const allWs: BackupWorkspace[] = [
      DEFAULT_WS,
      { id: "ws-work", name: "Work", is_default: false },
      { id: "ws-personal", name: "Personal", is_default: false },
    ];
    const groups = plan.buildGroups(allWs, DEFAULT_WS.id);
    expect(groups.get(DEFAULT_WS.id)?.map((r) => r.text)).toEqual(["default-1"]);
    expect(groups.get("ws-work")?.map((r) => r.text)).toEqual(["work-1", "work-2"]);
    expect(groups.get("ws-personal")?.map((r) => r.text)).toEqual(["personal-1"]);
  });

  it("falls back to default when a referenced workspace couldn't be created", () => {
    const rows = [
      makeRow({ text: "a", workspace_name: "Missing" }),
      makeRow({ text: "b", workspace_name: "Work" }),
    ];
    const plan = planRestore(rows, [DEFAULT_WS]);
    // Simulate that only "Work" was actually created; "Missing" failed.
    const allWs: BackupWorkspace[] = [
      DEFAULT_WS,
      { id: "ws-work", name: "Work", is_default: false },
    ];
    const groups = plan.buildGroups(allWs, DEFAULT_WS.id);
    expect(groups.get(DEFAULT_WS.id)?.map((r) => r.text)).toEqual(["a"]);
    expect(groups.get("ws-work")?.map((r) => r.text)).toEqual(["b"]);
  });
});
