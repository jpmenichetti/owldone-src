const EXPECTED_HEADERS = [
  "text", "category", "tags", "notes", "urls",
  "completed", "completed_at", "removed", "removed_at",
  "created_at", "updated_at",
];
const MAX_WORKSPACE_NAME = 100;


const VALID_CATEGORIES = ["today", "this_week", "next_week", "others"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 10_000;
const MAX_TEXT_LENGTH = 5_000;
const MAX_TAG_LENGTH = 100;
const MAX_URL_LENGTH = 2_048;
const MAX_TAGS = 50;
const MAX_URLS = 20;
const URL_PATTERN = /^https?:\/\/.+/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
// Block dangerous URL schemes even if disguised with whitespace/case.
const DANGEROUS_URL_SCHEME = /^(?:javascript|data|vbscript|file|about|blob):/i;

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

function decodeEntities(str: string): string {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const code = parseInt(d, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&[a-z]+;|&#39;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? "");
}

/**
 * Defense-in-depth sanitizer. React's JSX escaping is the actual XSS boundary,
 * but we also: strip tags + comments + CDATA, decode entities, drop control
 * chars, and remove zero-width characters that can hide payloads.
 */
function sanitizeText(str: string): string {
  if (!str) return "";
  let out = str;
  // Strip HTML/XML comments and CDATA blocks (which a naive tag stripper misses).
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  // Strip script/style blocks including their content.
  out = out.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  // Strip any remaining tags (handles unterminated tags by being greedy to '>').
  out = out.replace(/<\/?[a-z!][^>]*>?/gi, "");
  // Decode entities so encoded payloads can't slip through length checks intact.
  out = decodeEntities(out);
  // Run tag strip again post-decode in case entities re-introduced markup.
  out = out.replace(/<\/?[a-z!][^>]*>?/gi, "");
  // Remove zero-width and control chars (except tab/newline/carriage return).
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, "");
  return out;
}

function sanitizeUrl(raw: string): string | null {
  const cleaned = sanitizeText(raw).trim();
  if (!cleaned || cleaned.length > MAX_URL_LENGTH) return null;
  // Reject anything with whitespace embedded (likely smuggling).
  if (/\s/.test(cleaned)) return null;
  if (DANGEROUS_URL_SCHEME.test(cleaned)) return null;
  if (!URL_PATTERN.test(cleaned)) return null;
  try {
    const u = new URL(cleaned);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function parseBoolean(val: string): boolean | null {
  const v = val.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

export interface ImportedTodo {
  text: string;
  category: string;
  tags: string[];
  notes: string | null;
  urls: string[];
  completed: boolean;
  completed_at: string | null;
  removed: boolean;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Optional workspace name parsed from the CSV. `null` means the row had no
   * workspace (or the column was absent) — restore should put it into the
   * user's default workspace.
   */
  workspace_name: string | null;
}


export interface ImportResult {
  validTodos: ImportedTodo[];
  skippedCount: number;
}

export function validateCsvFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) return "File too large. Maximum size is 5MB.";
  if (!file.name.toLowerCase().endsWith(".csv")) return "Only CSV files are accepted.";
  const mime = file.type;
  if (mime && !mime.includes("csv") && !mime.includes("text/plain") && !mime.includes("application/vnd.ms-excel")) {
    return "Invalid file type. Please upload a CSV file.";
  }
  return null;
}

export async function importCsvFile(file: File): Promise<ImportResult> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) throw new Error("CSV file is empty or has no data rows.");
  if (lines.length - 1 > MAX_ROWS) throw new Error(`Too many rows. Maximum is ${MAX_ROWS}.`);

  // Validate headers
  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  for (const expected of EXPECTED_HEADERS) {
    if (!headers.includes(expected)) {
      throw new Error(`Missing required column: "${expected}".`);
    }
  }

  const headerIndex = Object.fromEntries(headers.map((h, i) => [h, i]));
  const validTodos: ImportedTodo[] = [];
  let skippedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    try {
      const fields = parseCsvLine(lines[i]);
      const get = (col: string) => (fields[headerIndex[col]] ?? "").trim();

      // Text - required
      const todoText = sanitizeText(get("text")).slice(0, MAX_TEXT_LENGTH).trim();
      if (!todoText) { skippedCount++; continue; }

      // Category
      const category = get("category").toLowerCase();
      if (!VALID_CATEGORIES.includes(category)) { skippedCount++; continue; }

      // Notes
      const notesClean = sanitizeText(get("notes")).slice(0, MAX_TEXT_LENGTH).trim();
      const notes: string | null = notesClean || null;

      // Tags
      const tagsRaw = get("tags");
      const tags = tagsRaw
        ? tagsRaw
            .split(";")
            .map((t) => sanitizeText(t).trim().slice(0, MAX_TAG_LENGTH))
            .filter(Boolean)
            .slice(0, MAX_TAGS)
        : [];

      // URLs — strict scheme + parse validation; drops javascript:/data:/etc.
      const urlsRaw = get("urls");
      const urls = urlsRaw
        ? urlsRaw
            .split(";")
            .map((u) => sanitizeUrl(u))
            .filter((u): u is string => u !== null)
            .slice(0, MAX_URLS)
        : [];

      // Booleans
      const completed = parseBoolean(get("completed"));
      const removed = parseBoolean(get("removed"));
      if (completed === null || removed === null) { skippedCount++; continue; }

      // Dates
      const created_at = get("created_at");
      const updated_at = get("updated_at");
      if (!ISO_DATE_PATTERN.test(created_at) || !ISO_DATE_PATTERN.test(updated_at)) {
        skippedCount++; continue;
      }

      const completed_at = get("completed_at");
      const removed_at = get("removed_at");

      // Workspace column is optional (older backups don't have it).
      const workspaceRaw = headerIndex["workspace"] !== undefined ? get("workspace") : "";
      const workspaceClean = sanitizeText(workspaceRaw).trim().slice(0, MAX_WORKSPACE_NAME);
      const workspace_name = workspaceClean || null;

      validTodos.push({
        text: todoText,
        category,
        tags,
        notes,
        urls,
        completed,
        completed_at: completed_at && ISO_DATE_PATTERN.test(completed_at) ? completed_at : null,
        removed,
        removed_at: removed_at && ISO_DATE_PATTERN.test(removed_at) ? removed_at : null,
        created_at,
        updated_at,
        workspace_name,
      });

    } catch {
      skippedCount++;
    }
  }

  return { validTodos, skippedCount };
}
