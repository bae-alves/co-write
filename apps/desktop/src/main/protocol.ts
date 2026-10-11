import { resolve, sep } from 'node:path'
import { isWithin } from './paths'

/**
 * Packaged builds serve the renderer from `app://co-write/` instead of `file://`: the page gets
 * a real origin (the server's CORS allows exactly this one; `file://` would send `Origin: null`)
 * and file access is limited to the bundled renderer folder.
 */
export const APP_SCHEME = 'app'
export const APP_HOST = 'co-write'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

/** The bundled file an `app://` URL refers to, or null if it points anywhere else. */
export function resolveAppAsset(rendererDir: string, url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return null
  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  if (pathname.includes('\0')) return null
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = resolve(rendererDir, relative.split('/').join(sep))
  return file !== rendererDir && isWithin(rendererDir, file) ? file : null
}
