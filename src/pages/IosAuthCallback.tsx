import { useEffect, useState } from "react";
import { lovable } from "@/integrations/lovable";

const IOS_SCHEME_URL = "com.owldone.app://login-callback";

type Status =
  | { kind: "starting" }
  | { kind: "redirecting"; deepLink: string }
  | { kind: "error"; message: string; deepLink: string };

const parseHashParams = (hash: string) => {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(trimmed);
};

const IosAuthCallback = () => {
  const [status, setStatus] = useState<Status>({ kind: "starting" });

  useEffect(() => {
    const hash = window.location.hash || "";
    const params = parseHashParams(hash);

    const error = params.get("error");
    const errorDescription = params.get("error_description");
    const accessToken = params.get("access_token");

    if (error) {
      const deepLink = `${IOS_SCHEME_URL}#${hash.startsWith("#") ? hash.slice(1) : hash}`;
      setStatus({
        kind: "error",
        message: errorDescription || error,
        deepLink,
      });
      // Try to bounce back to the app so it can surface the failure too.
      window.location.replace(deepLink);
      return;
    }

    if (accessToken) {
      const deepLink = `${IOS_SCHEME_URL}#${hash.startsWith("#") ? hash.slice(1) : hash}`;
      setStatus({ kind: "redirecting", deepLink });
      window.location.replace(deepLink);
      return;
    }

    // No tokens yet — kick off OAuth with this page as the redirect target.
    const redirectUri =
      window.location.origin + window.location.pathname;
    (async () => {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: redirectUri,
      });
      if (result.error) {
        const message =
          (result.error as { message?: string })?.message ?? "Sign-in failed";
        const deepLink = `${IOS_SCHEME_URL}#error=oauth_failed&error_description=${encodeURIComponent(
          message,
        )}`;
        setStatus({ kind: "error", message, deepLink });
      }
      // If result.redirected, the browser is navigating to Google. Nothing else to do.
    })();
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-4">
        {status.kind === "starting" && (
          <>
            <h1 className="text-xl font-semibold">Signing you in…</h1>
            <p className="text-sm text-muted-foreground">
              Redirecting to Google to authenticate.
            </p>
          </>
        )}

        {status.kind === "redirecting" && (
          <>
            <h1 className="text-xl font-semibold">Returning to OwlDone…</h1>
            <p className="text-sm text-muted-foreground">
              If the app doesn't open automatically, tap the button below.
            </p>
            <a
              href={status.deepLink}
              className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground font-medium"
            >
              Open OwlDone
            </a>
          </>
        )}

        {status.kind === "error" && (
          <>
            <h1 className="text-xl font-semibold">Sign-in failed</h1>
            <p className="text-sm text-muted-foreground break-words">
              {status.message}
            </p>
            <a
              href={status.deepLink}
              className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground font-medium"
            >
              Return to OwlDone
            </a>
          </>
        )}
      </div>
    </main>
  );
};

export default IosAuthCallback;
