## Goal
Add a disabled "premium features" icon button to the top navigation bar with a "Coming soon" tooltip.

## Changes

**File: `src/components/Navbar.tsx`**

1. Import additions:
   - `Sparkles` icon from `lucide-react` (signals premium/unlock).
   - `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` from `@/components/ui/tooltip`.

2. Insert a new disabled icon button in the right-side action cluster, placed before the admin shield button (so it sits left of admin/time-travel/language controls, immediately following any future left-side gap):
   ```tsx
   <TooltipProvider>
     <Tooltip>
       <TooltipTrigger asChild>
         {/* span wrapper so the tooltip still works on a disabled button */}
         <span tabIndex={0}>
           <Button
             variant="ghost"
             size="icon"
             disabled
             aria-label={t("nav.premiumComingSoon") ?? "Premium features — coming soon"}
           >
             <Sparkles className="h-4 w-4" />
           </Button>
         </span>
       </TooltipTrigger>
       <TooltipContent>
         {t("nav.premiumComingSoon") ?? "Coming soon"}
       </TooltipContent>
     </Tooltip>
   </TooltipProvider>
   ```

3. i18n: add a `nav.premiumComingSoon` key ("Coming soon" / "Próximamente" / "Bientôt disponible" / "Demnächst verfügbar") in `src/i18n/translations.ts` for EN/ES/FR/DE.

## Notes
- Disabled native buttons swallow pointer events, so the trigger is wrapped in a `<span>` to keep the tooltip working (standard Radix pattern).
- No click handler — purely a placeholder until the premium flow is wired up.
- Visual: ghost icon button, matching existing toolbar styling; the disabled opacity provided by `Button` already conveys the inactive state.
- No backend, route, or feature-flag changes required at this stage.
