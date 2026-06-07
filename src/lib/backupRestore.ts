import type { ImportedTodo } from "./importCsv";

export interface BackupWorkspace {
  id: string;
  name: string;
  is_default: boolean;
}

export interface RestorePlan {
  /** Workspace names from the CSV that need to be created (not yet in `existing`). */
  workspacesToCreate: string[];
  /**
   * Build the per-workspace row groups once all required workspaces exist.
   * Pass the full workspace list (existing + newly created) and the default.
   */
  buildGroups: (
    allWorkspaces: BackupWorkspace[],
    defaultWorkspaceId: string,
  ) => Map<string, ImportedTodo[]>;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Compute which workspaces must be created before a restore can run.
 * Matching is case-insensitive + trimmed; rows with no workspace name (or whose
 * resolved workspace cannot be matched/created) fall back to the default.
 */
export function planRestore(
  rows: ImportedTodo[],
  existing: BackupWorkspace[],
): RestorePlan {
  const existingByName = new Map(
    existing.map((w) => [normalizeName(w.name), w]),
  );

  const desiredNames = new Set<string>();
  for (const row of rows) {
    if (row.workspace_name) desiredNames.add(normalizeName(row.workspace_name));
  }

  const workspacesToCreate: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.workspace_name) continue;
    const key = normalizeName(row.workspace_name);
    if (existingByName.has(key) || seen.has(key)) continue;
    seen.add(key);
    workspacesToCreate.push(row.workspace_name.trim());
  }

  const buildGroups = (
    allWorkspaces: BackupWorkspace[],
    defaultWorkspaceId: string,
  ): Map<string, ImportedTodo[]> => {
    const lookup = new Map(
      allWorkspaces.map((w) => [normalizeName(w.name), w.id]),
    );
    const groups = new Map<string, ImportedTodo[]>();
    for (const row of rows) {
      let wsId = defaultWorkspaceId;
      if (row.workspace_name) {
        const matched = lookup.get(normalizeName(row.workspace_name));
        if (matched) wsId = matched;
      }
      const list = groups.get(wsId);
      if (list) list.push(row);
      else groups.set(wsId, [row]);
    }
    return groups;
  };

  return { workspacesToCreate, buildGroups };
}
