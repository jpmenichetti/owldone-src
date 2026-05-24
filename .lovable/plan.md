## GitHub Issue #18 — Drag-and-drop hit area too small

### Problem
On a task card, only the small `GripVertical` handle (~16px wide) accepts drag input. Clicks anywhere else on the card open the task detail panel. Users frequently miss the grip and accidentally open the task instead of moving it between categories.

### Solution
Make the entire `TodoCard` the drag source. Keep the grip icon as a visual affordance, but apply the drag `ref` + `listeners` + `attributes` to the card root.

This is safe because the existing DnD setup in `src/pages/Index.tsx` already gates activation:
- `PointerSensor` with `activationConstraint: { distance: 8 }` → a click without movement still fires `onClick` and opens the task.
- `TouchSensor` with `delay: 200, tolerance: 5` → a tap still opens; only a press-and-hold starts a drag, and scrolling cancels it.

Interactive children (checkbox, delete button, chevron button, grip wrapper) already call `e.stopPropagation()` on click, which keeps them working normally.

### Changes — `src/components/TodoCard.tsx`

1. Move `setDragRef`, `{...listeners}`, `{...attributes}` from the inner grip `<div>` to the outer card `<div>`.
2. Keep the grip `<div>` as a non-interactive visual indicator: drop its `ref`, `listeners`, `attributes`, and `onClick` stopPropagation; keep the `cursor-grab` styling so users still see the affordance on hover.
3. Add `touch-none` to the card root only on `md:` and up (e.g. `md:touch-none`) so mobile page scrolling is not blocked — touch drag is already gated by the 200 ms delay sensor.
4. Leave the `onClick={() => !isDragging && onOpen(todo)}` guard in place; combined with the 8 px activation distance, a genuine click still opens the task.

No changes to `Index.tsx`, sensors, drop targets, or backend.

### Verification
- Desktop: click anywhere on a card → detail panel opens. Press and drag (>8 px) anywhere on the card → drag overlay appears and the card can be dropped onto another category section.
- Desktop: clicking the checkbox toggles complete without opening the task; clicking delete/chevron buttons still works.
- Mobile (touch): tap → opens task. Press-and-hold ~200 ms then drag → moves card. Vertical page scroll on the task list still works.
- Existing category-transition behavior (timestamp reset on cross-category drops) is unaffected.
