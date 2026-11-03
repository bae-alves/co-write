import { createHash } from 'node:crypto'
import { request } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { signInWithOAuth } from './oauth'

const ORIGIN = 'https://write.example.com'

/** The system browser, after the provider is done: follows the server's redirect to the loopback. */
function browser(query: (start: URL) => string, hostHeader?: (port: string) => string | undefined) {
  const opened: URL[] = []
  const openExternal = vi.fn(async (url: string) => {
    const start = new URL(url)
    opened.push(start)
    const port = start.searchParams.get('port')!
    setTimeout(() => {
      request({
        host: '127.0.0.1',
        port: Number(port),
        path: `/?${query(start)}`,
        headers: hostHeader ? { host: hostHeader(port) ?? '' } : undefined,
      })
        .on('error', () => {})
        .end()
    }, 5)
  })
  return { opened, openExternal }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('signInWithOAuth', () => {
  it('opens the start URL with a loopback port and a PKCE challenge, then exchanges the code', async () => {
    const { opened, openExternal } = browser(() => 'code=one-time')
    const fetchMock = vi.fn(async () => json(200, { username: 'ana', token: 'tok' }))

    const session = await signInWithOAuth(
      { openExternal, fetch: fetchMock as unknown as typeof fetch },
      { origin: ORIGIN, provider: 'github' },
    )
    expect(session).toEqual({ username: 'ana', token: 'tok' })

    const start = opened[0]!
    expect(start.origin + start.pathname).toBe(`${ORIGIN}/api/oauth/github/start`)
    expect(Number(start.searchParams.get('port'))).toBeGreaterThan(1023)
    expect(start.searchParams.has('link')).toBe(false)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.href).toBe(`${ORIGIN}/api/oauth/exchange`)
    const body = JSON.parse(init.body as string) as { code: string; codeVerifier: string }
    expect(body.code).toBe('one-time')
    // The challenge sent to the server is the S256 of the verifier sent with the code.
    expect(createHash('sha256').update(body.codeVerifier).digest('base64url')).toBe(
      start.searchParams.get('code_challenge'),
    )
    expect(body.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('passes a link intent through when linking', async () => {
    const { opened, openExternal } = browser(() => 'code=c')
    await signInWithOAuth(
      {
        openExternal,
        fetch: (async () => json(200, { username: 'ana', token: 't' })) as unknown as typeof fetch,
      },
      { origin: ORIGIN, provider: 'oidc', linkIntent: 'intent-1' },
    )
    expect(opened[0]!.searchParams.get('link')).toBe('intent-1')
  })

  it('explains the errors the server sends back through the browser', async () => {
    for (const [error, message] of [
      ['access_denied', 'did not allow'],
      ['already_linked', 'already linked'],
      ['whatever', 'whatever'],
    ] as const) {
      const { openExternal } = browser(() => `error=${error}`)
      await expect(
        signInWithOAuth(
          { openExternal, fetch: (async () => json(200, {})) as unknown as typeof fetch },
          { origin: ORIGIN, provider: 'github' },
        ),
      ).rejects.toThrow(message)
    }
  })

  it('reports why the exchange failed', async () => {
    const { openExternal } = browser(() => 'code=c')
    await expect(
      signInWithOAuth(
        {
          openExternal,
          fetch: (async () =>
            json(401, { error: 'The PKCE verifier does not match.' })) as unknown as typeof fetch,
        },
        { origin: ORIGIN, provider: 'github' },
      ),
    ).rejects.toThrow('PKCE verifier')
  })

  it('ignores requests that are not the redirect, or that come with another Host', async () => {
    const { openExternal } = browser(
      () => 'code=ignored',
      (port) => `evil.example:${port}`,
    )
    await expect(
      signInWithOAuth(
        {
          openExternal,
          fetch: (async () => json(200, { username: 'a', token: 't' })) as unknown as typeof fetch,
          timeoutMs: 200,
        },
        { origin: ORIGIN, provider: 'github' },
      ),
    ).rejects.toThrow('timed out')
  })

  it('gives up after the timeout and frees the port', async () => {
    let port = 0
    const openExternal = vi.fn(async (url: string) => {
      port = Number(new URL(url).searchParams.get('port'))
    })
    await expect(
      signInWithOAuth(
        {
          openExternal,
          fetch: (async () => json(200, {})) as unknown as typeof fetch,
          timeoutMs: 50,
        },
        { origin: ORIGIN, provider: 'github' },
      ),
    ).rejects.toThrow('timed out')
    await expect(
      new Promise((resolve, reject) => {
        request({ host: '127.0.0.1', port, path: '/?code=late' }, resolve).on('error', reject).end()
      }),
    ).rejects.toThrow()
  })
})
