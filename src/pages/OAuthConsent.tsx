import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { lovable } from "@/integrations/lovable";

// Typed wrapper for the beta supabase.auth.oauth namespace.
type OAuthClient = { name?: string | null; client_uri?: string | null } | null;
type AuthorizationDetails = {
  client?: OAuthClient;
  scopes?: string[] | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{
    data: AuthorizationDetails | null;
    error: { message: string } | null;
  }>;
  approveAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string | null; redirect_to?: string | null } | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string | null; redirect_to?: string | null } | null;
    error: { message: string } | null;
  }>;
};
const oauthApi = () =>
  (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const { user, loading } = useAuth();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!authorizationId) {
      setError("Missing authorization_id");
      return;
    }
    if (!user) {
      // Preserve full consent URL, then sign in with Google (OwlDone's only auth).
      const next = window.location.pathname + window.location.search;
      try {
        sessionStorage.setItem("owldone_post_auth_return_to", next);
      } catch { /* ignore */ }
      lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + next,
      });
      return;
    }
    let active = true;
    (async () => {
      const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId, user, loading]);

  async function decide(approve: boolean) {
    setBusy(true);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="mb-3 text-2xl font-bold">Authorization error</h1>
        <p className="text-muted-foreground">{error}</p>
      </main>
    );
  }
  if (loading || !details) {
    return (
      <main className="mx-auto max-w-md p-8">
        <p className="text-muted-foreground">Loading…</p>
      </main>
    );
  }

  const clientName = details.client?.name ?? "An app";
  return (
    <main className="mx-auto max-w-md p-8 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">
          Connect {clientName} to OwlDone
        </h1>
        <p className="mt-2 text-muted-foreground">
          {clientName} is asking to access OwlDone as{" "}
          <span className="font-medium text-foreground">{user?.email}</span>. It
          will be able to read your tasks and workspaces and create or complete
          tasks on your behalf.
        </p>
      </div>
      <div className="flex gap-3">
        <Button onClick={() => decide(true)} disabled={busy}>
          Approve
        </Button>
        <Button variant="outline" onClick={() => decide(false)} disabled={busy}>
          Deny
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        You can revoke access at any time from your account settings.
      </p>
    </main>
  );
}
