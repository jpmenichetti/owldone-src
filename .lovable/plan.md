Move the "archive completed now" button from its separate row below the FilterBar into the same flex row as the filter controls. When horizontal space is tight, the button text hides and only the archive icon remains.

Changes:

1. **FilterBar.tsx** — Add three new optional props: `completedCount`, `onArchive`, and `isArchiving`. Inside the existing `flex flex-wrap items-center gap-2` container, after the clear-filters button, render the archive button conditionally when `completedCount > 0`. The button uses `variant="outline" size="sm"` with the `Archive` icon. Wrap the label text in a `<span className="hidden sm:inline">` so it collapses to icon-only on narrow viewports. The button is disabled while `isArchiving` is true.

2. **Index.tsx** — Remove the current archive button block (the IIFE that renders `<div className="flex justify-end">...`). Pass `completedCount`, `onArchive`, and `isArchiving` into `<FilterBar />` instead. The archive handler and toast logic stay in `Index.tsx` and are passed down as the `onArchive` callback.

No backend, auth, or data-model changes are required.