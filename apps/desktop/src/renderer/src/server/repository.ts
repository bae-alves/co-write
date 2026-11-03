import type { CoWriteApi } from '@co-write/shared'

let chosen: string | null = null

/**
 * Where the Ktor server lives: the origin the user chose (Connect to server…), or null. It is read
 * from main once at start-up; choosing another server reloads the window, which reads it again.
 * The CSP only allows this origin.
 */
export const serverUrl = (): string | null => chosen

export async function initServer(): Promise<void> {
  chosen =
    (await desktopApi()
      ?.getServer()
      .catch(() => null)) ?? null
}

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

  const base = chosen
  if (!base) throw new ApiError(0, 'No server chosen')
  let response: Response
  try {
    response = await fetch(new URL(path, base), {
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
