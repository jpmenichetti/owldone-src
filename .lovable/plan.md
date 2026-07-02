## Problem

When the search text changes, `useTodos(debouncedSearchText)` re-keys the `archived-todos` and `archived-todos-count` queries. While the new request is in flight, `archivedCount` falls to `0`, and `ArchiveSection` early-returns `null` (`if (visibleCount === 0) return null`), so the whole panel vanishes with no feedback until results arrive.

## Fix

1. **Keep previous data across search changes** in `src/hooks/useTodos.ts`:
   - Add `placeholderData: (prev) => prev` (react-query v5 equivalent of `keepPreviousData`) to both `archivedCountQuery` and `archivedQuery`.
   - Expose an `isArchivedSearching` boolean derived from `archivedQuery.isFetching || archivedCountQuery.isFetching` combined with `debouncedSearchText !== searchText` (already tracked via the query state).

2. **Show a busy indicator on the archive header** in `src/components/ArchiveSection.tsx`:
   - Accept a new optional `isSearching?: boolean` prop.
   - When `isSearching` is true, render a small `Loader2` spinner next to the archive title (in place of / alongside the count badge).
   - Also render the section (do not early-return) when `isSearching` is true even if `visibleCount === 0`, so users see the loader instead of a disappearing panel. When the fetch resolves with 0 matches, fall back to the current hidden behavior.

3. **Wire it up in `src/pages/Index.tsx`**:
   - Destructure the new `isArchivedSearching` flag from `useTodos`.
   - Pass it as `isSearching` to `<ArchiveSection />`.

No backend, translation, or business-logic changes are needed — this is a pure frontend / loading-state fix.

## Files touched

- `src/hooks/useTodos.ts` — `placeholderData` on the two archive queries + expose `isArchivedSearching`.
- `src/components/ArchiveSection.tsx` — new `isSearching` prop, spinner in header, don't hide while searching.
- `src/pages/Index.tsx` — pass the new prop through.
