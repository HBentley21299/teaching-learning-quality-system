export function apiFailureMessage(status: number, payload: unknown, retryAfter: string | null = null): string {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const defaults: Record<number, string> = {
    400: "Check the information entered and try again.",
    401: "Your session has expired. Sign in again before saving. Your unsaved changes remain on this page.",
    403: "You do not have permission to do that. Contact an administrator if you need access.",
    404: "This item is no longer available, or you do not have access to it.",
    409: "This item changed while you were editing. Reload the latest version and review your changes before saving.",
    429: "Too many requests. Please wait a moment, then try again."
  };
  const detail = [body.message, body.Message, body.detail, body.title].find(value => typeof value === "string" && value.trim());
  let message = status >= 500 ? "The service could not complete this request. Please try again or contact support."
    : status === 401 || status === 429 ? defaults[status]
    : typeof detail === "string" ? detail : defaults[status] ?? `The request could not be completed (${status}).`;
  if (status === 429 && retryAfter && /^\d+$/.test(retryAfter)) message += ` Try again in ${retryAfter} seconds.`;
  const traceId = body.traceId ?? (body.extensions as Record<string, unknown> | undefined)?.traceId;
  if (typeof traceId === "string" && traceId.length < 160) message += ` Support reference: ${traceId}.`;
  return message;
}
