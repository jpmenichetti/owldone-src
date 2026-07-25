// The iOS OAuth handoff must run before anything imports the Supabase client, so
// keep this as the FIRST import: its module side-effect reads the URL tokens
// before `detectSessionInUrl` can consume them.
import { handedOffToNativeApp } from "./ios-oauth-handoff";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

registerSW({ immediate: true });

// If we've forwarded the OAuth tokens to the native app, the page is navigating
// away — don't boot the web app (which would consume the session itself).
if (!handedOffToNativeApp) {
  createRoot(document.getElementById("root")!).render(<App />);
}