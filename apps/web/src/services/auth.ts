import {
  InteractionRequiredAuthError,
  PublicClientApplication
} from "@azure/msal-browser";

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID ?? "";
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID ?? "";
const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE ?? "";

// When the Entra settings are absent the app runs without sign-in and sends no
// Authorization header, matching the API's development authentication handler.
export const isAuthEnabled = Boolean(clientId && tenantId && apiScope);
const localLoginSetting = (import.meta.env.VITE_ENABLE_LOCAL_LOGIN ?? "").trim().toLowerCase();
export const isLocalLoginEnabled = localLoginSetting
  ? localLoginSetting === "true"
  : import.meta.env.DEV;
export const passwordResetUrl = "https://passwordreset.microsoftonline.com/";

const msalInstance = isAuthEnabled
  ? new PublicClientApplication({
      auth: {
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientId,
        redirectUri: window.location.origin
      },
      cache: {
        cacheLocation: "sessionStorage"
      }
    })
  : null;

const tokenRequest = { scopes: [apiScope] };

export async function initializeAuth(): Promise<void> {
  if (!msalInstance) {
    return;
  }

  await msalInstance.initialize();
  const redirectResult = await msalInstance.handleRedirectPromise();
  if (redirectResult?.account) {
    msalInstance.setActiveAccount(redirectResult.account);
    return;
  }

  const [account] = msalInstance.getAllAccounts();
  if (account) {
    msalInstance.setActiveAccount(account);
  }
}

// ---------------------------------------------------------------------------
// Local test-account sign-in (username/password). The API issues a sealed
// bearer token; it coexists with Microsoft sign-in and never replaces it.

const localTokenKey = "ielevate-local-token";
const localLoginApiBase = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "")
  || (import.meta.env.DEV ? "http://127.0.0.1:5001" : "");

export function getLocalToken(): string | null {
  return isLocalLoginEnabled ? localStorage.getItem(localTokenKey) : null;
}

export function clearLocalSession(): void {
  localStorage.removeItem(localTokenKey);
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (!isLocalLoginEnabled) {
    throw new Error("Test-account sign in is not enabled in this environment.");
  }
  const response = await fetch(`${localLoginApiBase}/api/v1/auth/login`, {
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  if (!response.ok) {
    let message = "Sign in failed. Check your email address and password.";
    try {
      const payload = (await response.json()) as { message?: string; Message?: string };
      message = payload.message ?? payload.Message ?? message;
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }
  const payload = (await response.json()) as { token: string };
  localStorage.setItem(localTokenKey, payload.token);
}

export function hasSignedInAccount(): boolean {
  return Boolean(getLocalToken() || msalInstance?.getActiveAccount());
}

export function signIn(): void {
  void msalInstance?.loginRedirect(tokenRequest);
}

export async function getAccessToken(): Promise<string | null> {
  const localToken = getLocalToken();
  if (localToken) {
    return localToken;
  }

  if (!msalInstance) {
    return null;
  }

  try {
    const result = await msalInstance.acquireTokenSilent(tokenRequest);
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await msalInstance.acquireTokenRedirect(tokenRequest);
    }
    return null;
  }
}

export function signOut(): void {
  if (getLocalToken()) {
    clearLocalSession();
    window.location.assign("/");
    return;
  }
  void msalInstance?.logoutRedirect();
}
