import { describe, it, expect } from "vitest";
import { importCsvFile } from "./importCsv";

function makeFile(content: string, name = "backup.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

const HEADER_NO_WS =
  "text,category,tags,notes,urls,completed,completed_at,removed,removed_at,created_at,updated_at";
const HEADER_WITH_WS = HEADER_NO_WS + ",workspace";

const ISO = "2026-01-01T00:00:00Z";

describe("importCsvFile — workspace column", () => {
  it("returns workspace_name = null for legacy backups without the column", async () => {
    const csv = [
      HEADER_NO_WS,
      `task one,today,,,,false,,false,,${ISO},${ISO}`,
    ].join("\n");
    const { validTodos, skippedCount } = await importCsvFile(makeFile(csv));
    expect(skippedCount).toBe(0);
    expect(validTodos).toHaveLength(1);
    expect(validTodos[0].workspace_name).toBeNull();
  });

  it("parses workspace_name when the column is present", async () => {
    const csv = [
      HEADER_WITH_WS,
      `task,today,,,,false,,false,,${ISO},${ISO},Work`,
      `task2,today,,,,false,,false,,${ISO},${ISO},Personal`,
    ].join("\n");
    const { validTodos } = await importCsvFile(makeFile(csv));
    expect(validTodos.map((t) => t.workspace_name)).toEqual(["Work", "Personal"]);
  });

  it("treats blank workspace cells as null (will route to default on restore)", async () => {
    const csv = [
      HEADER_WITH_WS,
      `task,today,,,,false,,false,,${ISO},${ISO},`,
    ].join("\n");
    const { validTodos } = await importCsvFile(makeFile(csv));
    expect(validTodos[0].workspace_name).toBeNull();
  });

  it("sanitizes HTML out of workspace names", async () => {
    const csv = [
      HEADER_WITH_WS,
      `task,today,,,,false,,false,,${ISO},${ISO},"<b>Work</b>"`,
    ].join("\n");
    const { validTodos } = await importCsvFile(makeFile(csv));
    expect(validTodos[0].workspace_name).toBe("Work");
  });

  it("still skips rows with invalid category even when workspace is set", async () => {
    const csv = [
      HEADER_WITH_WS,
      `task,not-a-cat,,,,false,,false,,${ISO},${ISO},Work`,
    ].join("\n");
    const { validTodos, skippedCount } = await importCsvFile(makeFile(csv));
    expect(validTodos).toHaveLength(0);
    expect(skippedCount).toBe(1);
  });
});
