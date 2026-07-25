// iOS OAuth bridge handoff.
//
// This module is imported FIRST in main.tsx — before the Supabase client is
// created — so it can read the OAuth tokens from the URL hash before Supabase's
// `detectSessionInUrl` consumes them. When a sign-in initiated from
// /auth/ios-callback returns to "/" with tokens, we forward them to the native
// app via its custom URL scheme instead of signing the web app in.
//
// The "pending" marker is kept in localStorage (survives the Google → Supabase →
// origin round-trip inside ASWebAuthenticationSession, where sessionStorage can be
// dropped). It is made safe for normal browser logins by: a short TTL, and being
// cleared on *every* load where it's present — so it can only ever act on the one
// page load that immediately follows the iOS sign-in.

export const IOS_PENDING_KEY = "owldone_ios_oauth_pending";
const IOS_PENDING_TTL_MS = 2 * 60 * 1000; // 2 minutes
const IOS_SCHEME_URL = "com.owldone.app://login-callback";

/** Set when we've redirected to the native app, so the SPA doesn't also boot. */
export let handedOffToNativeApp = false;

(function iosOAuthHandoff() {
  try {
    const raw = localStorage.getItem(IOS_PENDING_KEY);
    if (!raw) return;

    // Consume the marker on any load where it exists: it may only ever act on the
    // single load right after the iOS sign-in, never a later browser login.
    localStorage.removeItem(IOS_PENDING_KEY);

    const ts = Number(raw);
    const fresh = Number.isFinite(ts) && Date.now() - ts <= IOS_PENDING_TTL_MS;
    if (!fresh) return; // stale marker — cleaned up, ignore

    const hash = window.location.hash || "";
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    if (params.get("access_token") || params.get("error")) {
      handedOffToNativeApp = true;
      window.location.replace(`${IOS_SCHEME_URL}${hash}`);
    }
    // else: fresh marker but no tokens on this load (e.g. re-entering the callback
    // page). We've cleared it; IosAuthCallback re-sets it when it starts OAuth.
  } catch {
    // Ignore storage/parse errors — fall through to a normal web boot.
  }
})();