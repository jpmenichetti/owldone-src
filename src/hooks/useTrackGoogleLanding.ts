import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const SESSION_FLAG = "owldone:google_landing_logged";

/**
 * Detects whether the current page load came from Google (paid ads via
 * `?gclid=...` or organic search via referrer) and logs the visit once
 * per browser session. Fire-and-forget; never blocks UI.
 */
export function useTrackGoogleLanding() {
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (sessionStorage.getItem(SESSION_FLAG)) return;

      const params = new URLSearchParams(window.location.search);
      const gclid = params.get("gclid");
      const utm_source = params.get("utm_source");
      const utm_medium = params.get("utm_medium");
      const utm_campaign = params.get("utm_campaign");
      const utm_term = params.get("utm_term");
      const utm_content = params.get("utm_content");

      const referrer = document.referrer || "";
      let referrerHost = "";
      try { referrerHost = referrer ? new URL(referrer).hostname : ""; } catch {}
      const fromGoogleReferrer = /(^|\.)google\./i.test(referrerHost);

      let source: "google_ads" | "google_organic" | null = null;
      if (gclid || utm_source?.toLowerCase() === "google") source = "google_ads";
      else if (fromGoogleReferrer) source = "google_organic";

      if (!source) return;

      // Mark immediately so reloads / re-renders don't double-fire
      sessionStorage.setItem(SESSION_FLAG, "1");

      supabase.functions
        .invoke("log-landing-visit", {
          body: {
            source,
            landing_path: window.location.pathname || "/",
            gclid: gclid || undefined,
            utm_source: utm_source || undefined,
            utm_medium: utm_medium || undefined,
            utm_campaign: utm_campaign || undefined,
            utm_term: utm_term || undefined,
            utm_content: utm_content || undefined,
            referrer: referrer.slice(0, 2048) || undefined,
            language: navigator.language || undefined,
          },
        })
        .then(() => {})
        .catch(() => {
          // Allow retry next session if it failed
          sessionStorage.removeItem(SESSION_FLAG);
        });
    } catch {
      // Never throw from a telemetry hook
    }
  }, []);
}
