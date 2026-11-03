/**
 * End to end: real Yjs documents synced through y-websocket and the running Ktor server
 * (with PostgreSQL). Not part of `pnpm test`; run against a live server with
 *
 *   CO_WRITE_E2E_SERVER=http://localhost:8080 pnpm --filter @co-write/desktop test:e2e
 */
import { generateKeyPairSync, sign } from 'node:crypto'
import { normalizeOrigin, signedMessage } from '@co-write/shared'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { afterEach, describe, expect, it } from 'vitest'

const SERVER = process.env['CO_WRITE_E2E_SERVER'] ?? ''
const WS = `${SERVER.replace(/^http/, 'ws')}/ws/docs`
const providers: WebsocketProvider[] = []

async function api<T>(path: string, body?: unknown, token?: string, method = 'POST'): Promise<T> {
  const response = await fetch(`${SERVER}${path}`, {
    method: body === undefined && method === 'POST' ? 'POST' : method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

const unique = () => Math.random().toString(36).slice(2, 10)

/** Registers a new account the way the desktop does: an Ed25519 key signs a single-use challenge. */
async function user(): Promise<string> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const username = `e2e-${unique()}`
  const { nonce } = await api<{ nonce: string }>('/api/auth/challenge', {})
  const text = signedMessage({
    purpose: 'register',
    origin: normalizeOrigin(SERVER)!,
    nonce,
    username,
  })
  const { token } = await api<{ token: string }>('/api/auth/register', {
    username,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    nonce,
    signature: sign(null, Buffer.from(text), privateKey).toString('base64url'),
  })
  return token
}

/** A ticket works once, so every (re)connect fetches its own. */
const ticketFor = async (docId: string, token: string) =>
  (await api<{ ticket: string }>('/api/ws-ticket', { docId }, token)).ticket

function connect(docId: string, token: string, doc = new Y.Doc()) {
  const provider = new WebsocketProvider(WS, docId, doc, { disableBc: true, connect: false })
  providers.push(provider)
  const reconnect = async () => {
    provider.params = { ticket: await ticketFor(docId, token) }
    provider.connect()
  }
  const synced = new Promise<void>((resolve) => {
    const check = (isSynced: boolean) => isSynced && resolve()
    provider.on('sync', check)
  })
  void reconnect()
  return { doc, text: doc.getText('content'), provider, synced, reconnect }
}

const until = async (condition: () => boolean, ms = 5_000) => {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

afterEach(() => {
  providers.splice(0).forEach((provider) => provider.destroy())
})

describe.skipIf(!SERVER)('collaboration through the server', () => {
  it('syncs two editors, keeps offline edits, and persists the result', async () => {
    const ana = await user()
    const bo = await user()
    const { id } = await api<{ id: string }>('/api/docs', { title: 'E2E' }, ana)
    const boName = (await api<{ username: string }>('/api/auth/me', undefined, bo, 'GET')).username
    await api(`/api/docs/${id}/members`, { username: boName, role: 'editor' }, ana, 'PUT')

    const a = connect(id, ana)
    const b = connect(id, bo)
    await Promise.all([a.synced, b.synced])

    a.text.insert(0, '# Plan\n')
    await until(() => b.text.toString() === '# Plan\n')
    b.text.insert(b.text.length, '- from bo\n')
    await until(() => a.text.toString() === '# Plan\n- from bo\n')

    // bo goes offline and keeps typing; ana edits meanwhile.
    b.provider.disconnect()
    b.text.insert(0, '> offline\n')
    a.text.insert(a.text.length, '- from ana\n')
    await b.reconnect()
    await until(
      () => a.text.toString() === b.text.toString() && a.text.toString().includes('offline'),
    )
    expect(a.text.toString()).toBe('> offline\n# Plan\n- from bo\n- from ana\n')

    // Many edits trigger compaction; a fresh client still gets exactly the same text.
    for (let i = 0; i < 12; i++) a.text.insert(a.text.length, `${i}`)
    await until(() => b.text.toString() === a.text.toString())
    const fresh = connect(id, bo)
    await fresh.synced
    await until(() => fresh.text.toString() === a.text.toString())
  })

  it('makes viewers read-only on the server', async () => {
    const ana = await user()
    const cy = await user()
    const { id } = await api<{ id: string }>('/api/docs', { title: 'E2E' }, ana)
    const cyName = (await api<{ username: string }>('/api/auth/me', undefined, cy, 'GET')).username
    await api(`/api/docs/${id}/members`, { username: cyName, role: 'viewer' }, ana, 'PUT')

    const a = connect(id, ana)
    const viewer = connect(id, cy)
    await Promise.all([a.synced, viewer.synced])
    a.text.insert(0, 'owner text')
    await until(() => viewer.text.toString() === 'owner text')
    viewer.text.insert(0, 'sneaky ')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(a.text.toString()).toBe('owner text')

    const later = connect(id, ana)
    await later.synced
    await until(() => later.text.toString() === 'owner text')
  })

  it('closes for good without a valid ticket, and the session token is no longer a way in', async () => {
    const ana = await user()
    const { id } = await api<{ id: string }>('/api/docs', { title: 'E2E' }, ana)
    const attempts: Record<string, string>[] = [{ ticket: 'not-a-ticket' }, { token: ana }, {}]
    for (const params of attempts) {
      const doc = new Y.Doc()
      const provider = new WebsocketProvider(WS, id, doc, { disableBc: true, params })
      providers.push(provider)
      const closed = await new Promise<number>((resolve) =>
        provider.on('closed', ({ code }) => resolve(code)),
      )
      expect(closed).toBe(4401)
      expect(provider.shouldConnect).toBe(false)
    }
  })

  it('applies a role change at once: the socket closes, and the next connection has the new role', async () => {
    const ana = await user()
    const bo = await user()
    const { id } = await api<{ id: string }>('/api/docs', { title: 'E2E' }, ana)
    const boName = (await api<{ username: string }>('/api/auth/me', undefined, bo, 'GET')).username
    await api(`/api/docs/${id}/members`, { username: boName, role: 'editor' }, ana, 'PUT')

    const a = connect(id, ana)
    const b = connect(id, bo)
    await Promise.all([a.synced, b.synced])
    const dropped = new Promise<number>((resolve) =>
      b.provider.on('connection-close', (event: { code: number } | null) =>
        resolve(event?.code ?? 0),
      ),
    )
    await api(`/api/docs/${id}/members`, { username: boName, role: 'viewer' }, ana, 'PUT')
    expect(await dropped).toBe(4001)

    await b.reconnect()
    await until(() => b.provider.synced)
    b.text.insert(0, 'viewers cannot write')
    a.text.insert(0, 'owner ')
    await until(() => b.text.toString().includes('owner'))
    expect(a.text.toString()).toBe('owner ')
  })

  it('shuts a removed member out for good', async () => {
    const ana = await user()
    const bo = await user()
    const { id } = await api<{ id: string }>('/api/docs', { title: 'E2E' }, ana)
    const boName = (await api<{ username: string }>('/api/auth/me', undefined, bo, 'GET')).username
    await api(`/api/docs/${id}/members`, { username: boName, role: 'editor' }, ana, 'PUT')
    const b = connect(id, bo)
    await b.synced
    const closed = new Promise<number>((resolve) =>
      b.provider.on('closed', ({ code }) => resolve(code)),
    )
    await api(`/api/docs/${id}/members/${boName}`, undefined, ana, 'DELETE')
    expect(await closed).toBe(4403)
    await expect(ticketFor(id, bo)).rejects.toThrow('403')
  })
})
