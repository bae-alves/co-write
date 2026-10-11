import type { CoWriteApi } from '@co-write/shared'

/** Where the Ktor server lives. Fixed at build time; the CSP only allows this origin. */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const TIMEOUT_MS = 10_000

/** Shared HTTP plumbing for feature repositories that talk to the server's JSON API. */
export async function apiRequest<T>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(new URL(path, SERVER_URL), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new ApiError(0, 'Server unreachable')
  }
  if (response.status === 204) return undefined as T
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Server responded ${response.status}`
    throw new ApiError(response.status, message)
  }
  return body as T
}

/** `window.api`, or `null` when the renderer runs outside Electron (e.g. in a plain browser). */
export function desktopApi(): CoWriteApi | null {
  return (window as Window & { api?: CoWriteApi }).api ?? null
}
