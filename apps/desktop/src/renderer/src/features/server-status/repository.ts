import type { InstanceInfo } from '@co-write/shared'
import { desktopApi, serverUrl } from '@/server/repository'

export interface ServerHealth {
  readonly version: string
}

export interface ServerStatusRepository {
  /** Whether a server is chosen at all. */
  hasServer(): boolean
  /** Resolves when the server is healthy; rejects with a readable message otherwise. */
  health(): Promise<ServerHealth>
  /** What the server is: accounts or open, and which OAuth providers it offers. */
  instance(): Promise<InstanceInfo>
  /** Asks another server what it is, before choosing it. */
  probe(url: string): Promise<InstanceInfo>
  /** Chooses the server (null forgets it); the window reloads to connect to it. */
  setServer(url: string | null): Promise<void>
}

const TIMEOUT_MS = 5_000

async function getJson(path: string): Promise<unknown> {
  const base = serverUrl()
  if (!base) throw new Error('No server chosen')
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Server responded ${response.status}`)
  return response.json()
}

/** The only place in this feature that talks to the Ktor server. */
export function createServerStatusRepository(): ServerStatusRepository {
  const api = () => {
    const value = desktopApi()
    if (!value) throw new Error('Choosing a server needs the desktop app')
    return value
  }
  return {
    hasServer: () => serverUrl() !== null,
    async health() {
      const body = await getJson('/health')
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
    async instance() {
      const body = await getJson('/api/instance')
      const info = body as Partial<InstanceInfo> | null
      if (
        !info ||
        (info.auth !== 'none' && info.auth !== 'accounts') ||
        !Array.isArray(info.oauth)
      ) {
        throw new Error('This does not look like a co-write server')
      }
      return info as InstanceInfo
    },
    probe: (url) => api().probeServer(url),
    setServer: (url) => api().setServer(url),
  }
}

export const serverStatusRepository = createServerStatusRepository()
