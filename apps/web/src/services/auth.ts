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

export function hasSignedInAccount(): boolean {
  return !isAuthEnabled || Boolean(msalInstance?.getActiveAccount());
}

export function signIn(): void {
  void msalInstance?.loginRedirect(tokenRequest);
}

export async function getAccessToken(): Promise<string | null> {
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
  void msalInstance?.logoutRedirect();
}
