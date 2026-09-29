export class ApiHttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, statusText: string, url: string, message?: string) {
    super(message ?? `${status} ${statusText} for ${url}`);
    this.name = "ApiHttpError";
    this.status = status;
    this.url = url;
  }
}

export function isUnavailableFacultySettings(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 404
    && error.url === "/api/v1/reports/faculty-selections";
}
