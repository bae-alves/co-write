export interface ServerHealth {
  readonly version: string
}

export interface ServerStatusRepository {
  /** Resolves when the server is healthy; rejects with a readable message otherwise. */
  health(): Promise<ServerHealth>
}

const TIMEOUT_MS = 5_000

/** The only place in this feature that talks to the Ktor server. */
export function createServerStatusRepository(baseUrl: string): ServerStatusRepository {
  return {
    async health() {
      const response = await fetch(new URL('/health', baseUrl), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`Server responded ${response.status}`)
      const body: unknown = await response.json()
      if (
        typeof body !== 'object' ||
        body === null ||
        !('version' in body) ||
        typeof body.version !== 'string'
      ) {
        throw new Error('Unexpected /health response')
      }
      return { version: body.version }
    },
  }
}

export const serverStatusRepository = createServerStatusRepository(
  import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080',
)
