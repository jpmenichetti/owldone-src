## Problem

On mobile, starting a scroll gesture on a todo card triggers drag & drop instead of scrolling the list. The card never gets out of the way fast enough, so the user ends up dragging the task they meant to scroll past.

## Root cause

In `src/components/TodoCard.tsx`, the dnd-kit `listeners` and `attributes` from `useDraggable` are spread on the **entire card** `<div>`:

```tsx
<div
  ref={setDragRef}
  ...
  {...(readOnly ? {} : listeners)}
  {...(readOnly ? {} : attributes)}
>
```

This means any touch that lands anywhere on the card is captured by the TouchSensor. Even with the existing `TouchSensor` activation constraint (`delay: 200, tolerance: 5`), the tolerance is tight enough that natural finger movement during a scroll is often within 5px for the first 200ms, so dnd-kit claims the gesture and the page stops scrolling.

The grip icon (`GripVertical`) is already rendered as the intended drag affordance, and the project memory (`mem://ux/mobile-interaction-patterns`) explicitly says drag should be constrained to grip handles — so this is a regression from the documented pattern.

## Fix

Move the dnd-kit `listeners` / `attributes` off the card root and onto the `GripVertical` wrapper only.

### Changes in `src/components/TodoCard.tsx`

1. Remove `{...listeners} {...attributes}` from the outer `<div>` (the one with `ref={setDragRef}`).
2. Spread them on the grip handle `<div>` instead (the one that currently wraps `<GripVertical />`).
3. Keep `ref={setDragRef}` on the outer card so the drag overlay/transform still positions correctly.
4. Add `touch-none` to the grip wrapper so the browser doesn't try to scroll while the user is intentionally dragging via the handle. Leave the card root with default `touch-action` so vertical scrolling works everywhere else on the card.
5. Add an `aria-label` (e.g. "Drag to reorder") to the grip and drop `aria-hidden` since it becomes an interactive control.

No changes needed in `src/pages/Index.tsx` — the existing `PointerSensor` (distance: 8) and `TouchSensor` (delay: 200, tolerance: 5) sensors stay as-is and will now only fire from the handle.

## Behavior after fix

- Mobile: tapping/scrolling anywhere on the card body scrolls the list normally. Long-press on the grip starts a drag.
- Desktop: clicking the card still opens details; clicking the grip and dragging still moves the card across categories. Hover/keyboard behavior is unchanged.
- The completion checkbox, delete button, and chevron continue to work because they already stop propagation.

## Out of scope

- No sensor reconfiguration.
- No changes to `Index.tsx` drag handlers, categories, or the `created_at` reset on cross-category moves.
- No styling changes beyond `touch-none` on the grip and the new aria-label.
