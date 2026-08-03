## Goal
Let users mute the task-completion chime, with a speaker icon in the top toolbar. Sound stays enabled by default.

## What to build

1. **Sound preference store** (`src/lib/sounds.ts` + small hook)
   - Persist the flag in `localStorage` under `owldone_sound_enabled`; missing value = enabled.
   - `playCompletionSound()` returns early when disabled, so every current and future caller respects the setting with no changes.
   - A tiny `useSoundEnabled()` hook (`src/hooks/useSoundEnabled.ts`) exposes `{ soundEnabled, toggleSound }` and keeps the icon in sync.

2. **Toolbar control** (`src/components/Navbar.tsx`)
   - Add an icon-only ghost button next to the language selector: `Volume2` when on, `VolumeX` when off.
   - Tooltip + `aria-label` reading "Mute sound" / "Unmute sound", matching the existing tooltip pattern in the navbar.

3. **Translations** (`src/i18n/translations.ts`)
   - New keys `nav.soundOn` / `nav.soundOff` for all supported languages.

## Notes
- Purely client-side preference (localStorage), no backend or database change — consistent with it being a per-device setting.
