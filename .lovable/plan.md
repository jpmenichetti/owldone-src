# Fix: link inputs misbehave on task detail view

GitHub issue #16 reports two related bugs in the Links section of `TodoDetailDialog`:

1. With 3 link rows that share the same value, removing one removes all three.
2. After adding several distinct links, deleting one then deleting another causes a previously-deleted link to reappear.

## Root cause

In `src/components/TodoDetailDialog.tsx`:

- The list is rendered with `key={url}`. When two rows have the same URL string, React sees duplicate keys and reuses/removes the wrong DOM node on update — this is why "delete one stale node reappears" after subsequent edits.
- `removeUrl(url)` does `urls.filter((u) => u !== url)`, which removes every occurrence of that value, not the specific row the user clicked. This is why removing one of three identical links wipes all three.
- `addUrl` does not dedupe, so duplicates can be created in the first place, which then trigger both problems above.

## Fix

Make each row identified by its position, not its string value:

- Render with a stable per-row key: `key={`${idx}-${url}`}` and pass `idx` to the remove handler.
- Change `removeUrl(index: number)` to splice by index: `urls.filter((_, i) => i !== index)`.
- In `addUrl`, reject duplicates of an existing URL (toast: "Link already added") so the list stays a set in practice and the input UX matches user expectation.

No backend, schema, or styling changes — purely a presentation/state bug in one component.

## Files touched

- `src/components/TodoDetailDialog.tsx` — `addUrl`, `removeUrl`, and the `.urls?.map(...)` render block (lines ~227–246 and ~477–490).

## Verification

- Add 3 identical links → remove one → only that row disappears, two remain.
- Add 5 distinct links → delete the 5th → delete the 1st → no ghost link reappears; final list is exactly 3 links in original order minus the removed ones.
- Adding a link that already exists shows a toast and does not append.
