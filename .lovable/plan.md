# Download All Weekly Reports

Add a way to export every weekly report into a single downloadable file in three formats: **PDF**, **DOCX**, and **Markdown**.

## UX

In `WeeklyReportSection.tsx`, next to the existing "Generate" button, add a "Download" dropdown (shadcn `DropdownMenu`) with three items:
- Download as PDF
- Download as DOCX
- Download as Markdown

The button is disabled when there are no reports. All labels are localized via `i18n/translations.ts` (`report.download`, `report.downloadPdf`, `report.downloadDocx`, `report.downloadMd`).

## File content

Reports are sorted **oldest → newest**. Each report is rendered as:

- **Title**: `Week of {start} – {end}` (localized via existing `report.weekOf`, dates formatted with the user's locale)
- **Body**: the report `summary` text
- **Footer line**: `{count} task(s)` (reuses existing `todo.taskSingular` / `todo.taskPlural`)
- Blank line / page break between reports

Filename: `owldone-weekly-reports-YYYY-MM-DD.{pdf|docx|md}` (mirrors `exportCsv.ts` convention).

## Implementation

All generation happens **client-side** in a new `src/lib/exportWeeklyReports.ts` with three functions: `exportReportsMd`, `exportReportsDocx`, `exportReportsPdf`. Each takes `WeeklyReport[]` plus a `t` translator and triggers a browser download (same `Blob` + anchor pattern as `exportCsv.ts`).

**Libraries** (added via `bun add`):
- `docx` — DOCX generation (pure JS, browser-compatible)
- `jspdf` — PDF generation (lightweight, no native deps)
- Markdown is generated with plain string concatenation, no dependency.

**Wiring**: `WeeklyReportSection` imports the three helpers and calls them from the dropdown items, passing `reports` (already sorted newest→oldest by the query — reverse before export) and `t`.

## Scope

- Frontend only. No backend, edge function, or DB changes.
- No change to how reports are generated or stored.
- New translation keys added to every supported language in `src/i18n/translations.ts`.

## Files

- **New**: `src/lib/exportWeeklyReports.ts`
- **Edit**: `src/components/WeeklyReportSection.tsx` (add dropdown + handlers)
- **Edit**: `src/i18n/translations.ts` (4 new keys × all languages)
- **Edit**: `package.json` (add `docx`, `jspdf`)
