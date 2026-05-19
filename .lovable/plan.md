# Fix: cursor pointer on popover/menu items

GitHub issue #15: items inside popovers don't show a pointer cursor on hover, so they don't feel clickable.

## Root cause

The shadcn `DropdownMenu` primitives in `src/components/ui/dropdown-menu.tsx` are wired with `cursor-default`:

- `DropdownMenuItem` (line 82)
- `DropdownMenuSubTrigger` (line 28)
- `DropdownMenuCheckboxItem` (line 98)
- `DropdownMenuRadioItem` (further down, same pattern)

Every menu in the app (Navbar account/data menu, etc.) inherits this, so clickable rows look static on hover. Other interactive items already inside `PopoverContent` (e.g. `FilterBar` tag chips) already use `cursor-pointer`, so the fix is scoped to the dropdown-menu primitives.

## Fix

In `src/components/ui/dropdown-menu.tsx`, replace `cursor-default` with `cursor-pointer` on the four interactive primitive classNames (Item, SubTrigger, CheckboxItem, RadioItem). Disabled state still wins because `data-[disabled]:pointer-events-none` removes hover entirely.

Quick audit of the other two popover surfaces while we're here:

- `FilterBar` tag chips — already `cursor-pointer`.
- `CategorySection` info popover — text-only, no actionable items. No change.
- `Admin.tsx` / `DevTimeTravel.tsx` popovers wrap `Calendar`/buttons that already have proper cursors. No change.

## Files touched

- `src/components/ui/dropdown-menu.tsx` — swap `cursor-default` → `cursor-pointer` on Item, SubTrigger, CheckboxItem, RadioItem.

## Verification

- Open Navbar account/data dropdown → hovering "Export CSV", "Import CSV", feedback link, "Sign out" shows a pointer cursor.
- Disabled items (if any) still show the default cursor / no pointer.
