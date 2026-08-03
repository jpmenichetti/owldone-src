const SOUND_PREF_KEY = "owldone_sound_enabled";
export const SOUND_PREF_EVENT = "owldone:sound-pref-changed";

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? "true" : "false");
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(new Event(SOUND_PREF_EVENT));
}

export function playCompletionSound() {
  if (!isSoundEnabled()) return;

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };

    // E6 → A6 → C7 bright cheerful chime
    playTone(1318.5, now, 0.1);
    playTone(1760.0, now + 0.07, 0.1);
    playTone(2093.0, now + 0.14, 0.18);
  } catch {
    // silently ignore
  }
}
