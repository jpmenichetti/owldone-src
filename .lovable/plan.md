## Goal

Let the native iOS proof-of-concept reuse the existing Lovable-managed Google OAuth flow by handing the resulting session back to the app via the `com.owldone.app://login-callback` custom scheme. Lovable Cloud's OAuth broker only allow-lists `https://` redirect targets, so we can't point Google straight at the custom scheme — we bridge through a small web page on the existing `https://owldone.toolkas.cl` origin.

No Apple Developer account / Team ID is needed for this approach (Universal Links / AASA are explicitly skipped).

## Flow

```text
iOS app
  └─ ASWebAuthenticationSession(
       url: https://owldone.toolkas.cl/auth/ios-callback,
       callbackURLScheme: "com.owldone.app")
            │
            ▼
   /auth/ios-callback  ──▶  lovable.auth.signInWithOAuth("google",
                                { redirect_uri: same /auth/ios-callback URL })
            │
   Google → Lovable broker → back to /auth/ios-callback#access_token=...&refresh_token=...
            │
   page reads hash, window.location.replace(
     "com.owldone.app://login-callback#<original hash>")
            │
            ▼
   iOS intercepts the custom scheme, parses tokens,
   calls supabase.auth.setSession(...)
```

## Changes

### 1. New route `/auth/ios-callback`

New page `src/pages/IosAuthCallback.tsx`, registered in `src/App.tsx` as a public route (no auth guard).

Behavior on mount:
1. If `window.location.hash` contains `access_token` (or `error`): build `com.owldone.app://login-callback#<original hash>` and `window.location.replace(...)`. Show a fallback "Return to the OwlDone app" button + the same deep link in case the auto-redirect is blocked by the in-app browser.
2. Otherwise kick off `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.href.split("#")[0].split("?")[0] })`. Show a "Signing you in…" spinner.
3. On `error` in the hash, render the `error_description` plus the same "Return to app" deep link (so iOS can surface the failure).

### 2. Keep `AuthProvider` out of the way on this route

In `src/hooks/useAuth.tsx`, short-circuit so the provider does nothing on `/auth/ios-callback`:
- Skip the `tryAutoLogin` branch (otherwise it would re-trigger OAuth with `redirect_uri = window.location.origin` and break the iOS hand-off).
- Skip writing `owldone_was_signed_in` and the `consumeReturnTo()` redirect — this browser session is throwaway, owned by `ASWebAuthenticationSession`.

Effectively: if `window.location.pathname === "/auth/ios-callback"`, set `loading = false` and return early from the effect.

### 3. iOS side (informational, no code in this repo)

- Register URL scheme `com.owldone.app` in `Info.plist` (`CFBundleURLTypes`).
- Open `https://owldone.toolkas.cl/auth/ios-callback` with `ASWebAuthenticationSession(url:..., callbackURLScheme: "com.owldone.app")`.
- In the completion handler, parse `access_token` / `refresh_token` from the returned URL's fragment and call `supabase.auth.setSession(...)` in supabase-swift.

## Out of scope

- No Apple App Site Association / Universal Links (no Team ID, no paid dev account needed).
- No Supabase / Lovable Cloud OAuth allowlist changes (not possible from Lovable Cloud anyway).
- No changes to the existing web `/` sign-in flow.
- No new translations — bridge page is English-only (it's a transient screen the user barely sees).

## Open questions

None — ready to implement on approval.
