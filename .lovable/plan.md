## Problem

When a card is dragged into another category, the optimistic update moves it correctly, but @dnd-kit's default drop animation flies the `DragOverlay` back to the original draggable's position before disappearing — making it look like the drop was rejected.

## Fix

In `src/pages/Index.tsx`, change the `DragOverlay` so it does not animate back to the origin when the drop is accepted:

- Track the drop outcome from `handleDragEnd` (moved vs. cancelled) in a ref.
- Pass `dropAnimation={null}` to `DragOverlay` when the card was moved to a different category, so the overlay just fades out in place. Keep a short default animation for cancelled drops (dropped outside any category) so those still snap back as a visual cue.

No changes to `TodoCard`, `CategorySection`, or the mutation logic — this is purely a drag-overlay animation tweak.

## Technical notes

- `dropAnimation` on `DragOverlay` accepts `null` to disable the return-to-origin transition (dnd-kit v6+).
- The ref approach avoids re-rendering `DndContext` mid-drag; we read the ref inside the `dropAnimation` prop via a small state flip on `onDragEnd`.
