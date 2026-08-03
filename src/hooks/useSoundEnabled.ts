import { useCallback, useEffect, useState } from "react";
import { isSoundEnabled, setSoundEnabled, SOUND_PREF_EVENT } from "@/lib/sounds";

export function useSoundEnabled() {
  const [soundEnabled, setEnabled] = useState<boolean>(() => isSoundEnabled());

  useEffect(() => {
    const sync = () => setEnabled(isSoundEnabled());
    window.addEventListener(SOUND_PREF_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SOUND_PREF_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled(!isSoundEnabled());
  }, []);

  return { soundEnabled, toggleSound };
}
