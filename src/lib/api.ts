'use client';

/**
 * Safe API fetch helper that ensures JSON responses and proper error handling.
 * Prevents "Unexpected token '<'" errors by validating content-type before parsing.
 */

export interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  ok: boolean;
  data: T | null;
  error: ApiError | null;
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Expected JSON response but got ${contentType || 'empty response'}: ${text.slice(0, 200)}`
    );
  }
  return response.json();
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      let errorData: Record<string, unknown> = {};
      try {
        errorData = (await parseJsonSafely(response)) as Record<string, unknown>;
      } catch {
        // Non-JSON error response
        errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const error: ApiError = new Error(
        (errorData.error as string) || `Request failed with status ${response.status}`
      );
      error.status = response.status;
      error.code = (errorData.code as string) || 'api_error';
      error.details = errorData;

      return { ok: false, data: null, error };
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return { ok: true, data: null, error: null };
    }

    const data = (await parseJsonSafely(response)) as T;
    return { ok: true, data, error: null };
  } catch (err) {
    if (err instanceof Error && err.message.includes('Expected JSON')) {
      const error: ApiError = new Error(
        'Server returned non-JSON response. This may indicate an authentication redirect or server error.'
      );
      error.code = 'invalid_response';
      error.status = 500;
      return { ok: false, data: null, error };
    }

    const error: ApiError = err instanceof Error ? err : new Error(String(err));
    error.code = error.code || 'network_error';
    return { ok: false, data: null, error };
  }
}

// Convenience methods
export const api = {
  get: <T>(url: string) => apiFetch<T>(url, { method: 'GET' }),
  post: <T>(url: string, body?: unknown) =>
    apiFetch<T>(url, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(url: string, body?: unknown) =>
    apiFetch<T>(url, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(url: string) => apiFetch<T>(url, { method: 'DELETE' }),
};