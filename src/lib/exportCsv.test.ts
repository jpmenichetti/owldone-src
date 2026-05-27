import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportTodosCsv } from "./exportCsv";

type Todo = Parameters<typeof exportTodosCsv>[0][number];

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "t1",
    text: "hello",
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
    ...overrides,
  } as Todo;
}

/**
 * Captures the CSV text written to the Blob during exportTodosCsv().
 * Replaces Blob, URL, and link click side-effects with spies.
 */
function captureCsv(todos: Todo[]): string {
  let captured = "";
  const origBlob = globalThis.Blob;
  // @ts-expect-error — override for capture
  globalThis.Blob = class {
    constructor(parts: BlobPart[]) {
      captured = parts.map(String).join("");
    }
  };

  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});

  try {
    exportTodosCsv(todos);
  } finally {
    globalThis.Blob = origBlob;
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    clickSpy.mockRestore();
  }
  return captured;
}

describe("exportTodosCsv", () => {
  beforeEach(() => {
    // jsdom provides anchor.click but not download triggering — spied above.
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits header row with all expected columns", () => {
    const csv = captureCsv([]);
    expect(csv.split("\n")[0]).toBe(
      "text,category,tags,notes,urls,completed,completed_at,removed,removed_at,created_at,updated_at",
    );
  });

  it("emits one row per todo with header", () => {
    const csv = captureCsv([makeTodo({ text: "a" }), makeTodo({ text: "b" })]);
    expect(csv.split("\n")).toHaveLength(3);
  });

  it("joins tags and urls with a semicolon", () => {
    const csv = captureCsv([
      makeTodo({ tags: ["red", "blue"], urls: ["https://a", "https://b"] }),
    ]);
    expect(csv).toContain("red;blue");
    expect(csv).toContain("https://a;https://b");
  });

  it("renders null notes/completed_at/removed_at as empty cells", () => {
    const csv = captureCsv([makeTodo({ notes: null, completed_at: null, removed_at: null })]);
    const row = csv.split("\n")[1];
    // text,category,tags,notes,urls,completed,completed_at,removed,removed_at,created_at,updated_at
    const cells = row.split(",");
    expect(cells[3]).toBe(""); // notes
    expect(cells[6]).toBe(""); // completed_at
    expect(cells[8]).toBe(""); // removed_at
  });

  describe("formula-injection neutralisation", () => {
    it.each([
      ["=", "=1+1"],
      ["+", "+CMD"],
      ["-", "-2"],
      ["@", "@SUM(1,2)"],
      ["\\t", "\tTAB"],
      ["\\r", "\rCR"],
    ])("prefixes a tab when text starts with %s", (_label, payload) => {
      const csv = captureCsv([makeTodo({ text: payload })]);
      // Tab-prefixed value also contains a tab, so it must be quoted.
      // Inside the quotes, the original payload is preserved verbatim.
      expect(csv).toContain(`"\t${payload}"`);
    });

    it("does NOT prefix tab for benign text starting with safe characters", () => {
      const csv = captureCsv([makeTodo({ text: "Hello world" })]);
      const row = csv.split("\n")[1];
      expect(row.startsWith("Hello world,")).toBe(true);
    });

    it("neutralises formula prefix in notes field", () => {
      const csv = captureCsv([makeTodo({ notes: "=BAD()" })]);
      expect(csv).toContain('"\t=BAD()"');
    });

    it("neutralises formula prefix inside joined tags (first tag risk)", () => {
      const csv = captureCsv([makeTodo({ tags: ["=evil", "ok"] })]);
      expect(csv).toContain('"\t=evil;ok"');
    });
  });

  describe("CSV escaping", () => {
    it("wraps and double-quotes values containing commas", () => {
      const csv = captureCsv([makeTodo({ text: "a,b,c" })]);
      expect(csv).toContain('"a,b,c"');
    });

    it("escapes embedded double quotes by doubling them", () => {
      const csv = captureCsv([makeTodo({ text: 'she said "hi"' })]);
      expect(csv).toContain('"she said ""hi"""');
    });

    it("wraps values containing newlines", () => {
      const csv = captureCsv([makeTodo({ text: "line1\nline2" })]);
      expect(csv).toContain('"line1\nline2"');
    });

    it("wraps values containing carriage returns", () => {
      const csv = captureCsv([makeTodo({ text: "a\rb" })]);
      // Tab-prefixed because \r is a leading-char risk too? No, \r is in middle here.
      // Starts with 'a' — safe; but contains \r so must be quoted.
      expect(csv).toContain('"a\rb"');
    });
  });

  it("serialises boolean completed/removed as 'true'/'false'", () => {
    const csv = captureCsv([
      makeTodo({ completed: true, removed: false }),
      makeTodo({ completed: false, removed: true }),
    ]);
    const rows = csv.split("\n");
    expect(rows[1].split(",")[5]).toBe("true");
    expect(rows[1].split(",")[7]).toBe("false");
    expect(rows[2].split(",")[5]).toBe("false");
    expect(rows[2].split(",")[7]).toBe("true");
  });

  it("treats undefined tags/urls as empty arrays", () => {
    const csv = captureCsv([makeTodo({ tags: undefined as any, urls: undefined as any })]);
    const row = csv.split("\n")[1];
    const cells = row.split(",");
    expect(cells[2]).toBe(""); // tags
    expect(cells[4]).toBe(""); // urls
  });

  it("handles empty todo list (header only)", () => {
    const csv = captureCsv([]);
    expect(csv).not.toContain("\n");
  });
});
