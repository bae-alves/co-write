import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Credentials } from '@co-write/shared'
import { z } from 'zod'

export interface OAuthDeps {
  /** Opens a URL in the user's system browser. Only ever called with the URL built here. */
  readonly openExternal: (url: string) => Promise<void>
  readonly fetch: typeof fetch
  /** How long to wait for the user to finish in the browser. */
  readonly timeoutMs?: number
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>co-write</title>
<body style="font:16px system-ui;background:#1D0F14;color:#F6DCE2;display:grid;place-items:center;height:100vh;margin:0">
<p>You can close this tab and go back to co-write.</p></body>`

const ERRORS: Record<string, string> = {
  access_denied: 'The provider did not allow the sign-in.',
  already_linked: 'That account is already linked to another co-write account.',
  provider_error: 'The provider could not be reached or refused the request.',
  signup_failed: 'Could not create an account for that identity.',
  account_gone: 'The account to link to no longer exists.',
}

const SessionSchema = z.object({ username: z.string().min(1), token: z.string().min(1) })

/**
 * Desktop OAuth: PKCE with a loopback redirect, so no secret and no token ever sits in a URL.
 *
 *  1. Listen on a random 127.0.0.1 port and open `<server>/api/oauth/<provider>/start` in the
 *     system browser, with that port and the PKCE challenge.
 *  2. The server does the provider round-trip (its client secret stays on it) and sends the browser
 *     back to `http://127.0.0.1:<port>/?code=…`, a one-time code.
 *  3. Exchange the code and the PKCE verifier for a session token.
 *
 * With `linkIntent` the code signs in as the account that asked for the link.
 */
export async function signInWithOAuth(
  deps: OAuthDeps,
  request: { origin: string; provider: string; linkIntent?: string | undefined },
): Promise<Credentials> {
  const { origin, provider, linkIntent } = request
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  let server: Server | undefined
  let timer: NodeJS.Timeout | undefined
  try {
    const listening = createServer()
    server = listening
    await new Promise<void>((resolve, reject) => {
      listening.once('error', reject)
      listening.listen(0, '127.0.0.1', resolve)
    })
    const { port } = listening.address() as AddressInfo

    const redirect = new Promise<URLSearchParams>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Sign-in timed out. Try again.')),
        deps.timeoutMs ?? 5 * 60_000,
      )
      listening.on('request', (req, res) => {
        // Only the browser we sent to the provider, on exactly this address (no DNS rebinding).
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
        const answered = url.searchParams.has('code') || url.searchParams.has('error')
        if (
          req.method !== 'GET' ||
          req.headers.host !== `127.0.0.1:${port}` ||
          url.pathname !== '/' ||
          !answered
        ) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(DONE_PAGE)
        resolve(url.searchParams)
      })
    })
    // A timeout or an early failure must not leave this promise rejecting unobserved.
    redirect.catch(() => {})

    const start = new URL(`/api/oauth/${encodeURIComponent(provider)}/start`, origin)
    start.searchParams.set('port', String(port))
    start.searchParams.set('code_challenge', challenge)
    if (linkIntent) start.searchParams.set('link', linkIntent)
    await deps.openExternal(start.href)

    const params = await redirect
    const error = params.get('error')
    if (error) throw new Error(ERRORS[error] ?? `Sign-in failed (${error}).`)
    const code = params.get('code')
    if (!code) throw new Error('The server sent no sign-in code.')

    const response = await deps.fetch(new URL('/api/oauth/exchange', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, codeVerifier: verifier }),
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const reason = z.object({ error: z.string() }).safeParse(body)
      throw new Error(
        reason.success ? reason.data.error : `The server answered ${response.status}.`,
      )
    }
    return SessionSchema.parse(body)
  } finally {
    clearTimeout(timer)
    server?.close()
    server?.closeAllConnections()
  }
}
