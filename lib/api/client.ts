import { API_BASE_URL, CSRF_HEADER } from "./config";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Fetches a CSRF token from the backend. Resolves to null if none is issued. */
export async function fetchCsrfToken(signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(`${API_BASE_URL}/api/csrf-token`, { signal });
  return res.headers.get(CSRF_HEADER);
}

/** Builds request headers, adding JSON content type and the CSRF token when present. */
export function buildHeaders(
  csrfToken: string | null | undefined,
  extra?: HeadersInit,
): Headers {
  const headers = new Headers(extra);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set(CSRF_HEADER, csrfToken);
  return headers;
}

/** Resolves a path against API_BASE_URL; absolute URLs pass through unchanged. */
export function apiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

type ApiFetchInit = Omit<RequestInit, "body"> & {
  csrfToken?: string | null;
  json?: unknown;
};

/** JSON fetch wrapper: sends `json` as the body, throws ApiError on non-2xx. */
export async function apiFetch<T = unknown>(
  path: string,
  { csrfToken, json, headers, ...init }: ApiFetchInit = {},
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: buildHeaders(csrfToken, headers),
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // non-JSON response; keep raw text
  }
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
  return body as T;
}
