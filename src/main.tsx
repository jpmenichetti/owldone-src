import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

registerSW({ immediate: true });

// iOS OAuth bridge: if a sign-in was initiated from /auth/ios-callback,
// the Lovable OAuth broker only allows the bare origin as redirect_uri,
// so tokens land at "/" with a hash. Intercept them here BEFORE Supabase
// auto-consumes the hash, and hand off to the native app via the custom
// URL scheme.
const IOS_PENDING_KEY = "owldone_ios_oauth_pending";
const IOS_SCHEME_URL = "com.owldone.app://login-callback";
try {
  const pending = sessionStorage.getItem(IOS_PENDING_KEY);
  const hash = window.location.hash || "";
  if (pending === "1" && hash.length > 1) {
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    if (params.get("access_token") || params.get("error")) {
      sessionStorage.removeItem(IOS_PENDING_KEY);
      window.location.replace(`${IOS_SCHEME_URL}${hash}`);
      // Stop further app boot — the page is leaving anyway.
      throw new Error("__ios_oauth_handoff__");
    }
  }
} catch (err) {
  if ((err as Error)?.message === "__ios_oauth_handoff__") {
    // Swallow: handoff already kicked off via window.location.replace.
  }
}

createRoot(document.getElementById("root")!).render(<App />);
