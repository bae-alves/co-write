import { readFile } from 'node:fs/promises'
import { normalizeOrigin } from '@co-write/shared'
import { z } from 'zod'
import { storeBytes } from './storage'

/**
 * Which server this installation talks to. Chosen at runtime (there is no official server), kept
 * in `settings.json`, and the only thing the Content-Security-Policy's `connect-src` follows.
 */
export interface ServerSetting {
  /** The server's origin (`https://write.example.com`), or null while none is chosen. */
  origin(): string | null
  /** Chooses the server; null forgets it. Throws when `url` is not an http(s) address. */
  set(url: string | null): Promise<void>
}

const SettingsSchema = z.object({ serverUrl: z.string().nullable() })

export async function loadServerSetting(
  file: string,
  /** Used until the user chooses one: `CO_WRITE_SERVER`, handy in development and containers. */
  fallback: string | null = null,
): Promise<ServerSetting> {
  let current: string | null = null
  try {
    const parsed = SettingsSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
    if (parsed.success) current = parsed.data.serverUrl && normalizeOrigin(parsed.data.serverUrl)
  } catch {
    // No settings yet (or unreadable): fall back to the default.
    current = null
  }
  let origin = current ?? (fallback ? normalizeOrigin(fallback) : null)

  return {
    origin: () => origin,
    async set(url) {
      const next = url === null ? null : normalizeOrigin(url)
      if (url !== null && next === null) {
        throw new Error('Enter the server address, starting with http:// or https://')
      }
      await storeBytes(file, new TextEncoder().encode(JSON.stringify({ serverUrl: next })))
      origin = next
    },
  }
}
