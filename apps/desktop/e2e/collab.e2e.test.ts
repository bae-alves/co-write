/**
 * End to end: real Yjs documents synced through y-websocket and the running Ktor server
 * (with PostgreSQL). Not part of `pnpm test`; run against a live server with
 *
 *   CO_WRITE_E2E_SERVER=http://localhost:8080 pnpm --filter @co-write/desktop test:e2e
 */
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

async function user(): Promise<string> {
  const { token } = await api<{ token: string }>('/api/auth/register', {
    username: `e2e-${unique()}`,
    password: 'password1',
  })
  return token
}

function connect(docId: string, token: string, doc = new Y.Doc()) {
  const provider = new WebsocketProvider(WS, docId, doc, { params: { token }, disableBc: true })
  providers.push(provider)
  const synced = new Promise<void>((resolve) => {
    const check = (isSynced: boolean) => isSynced && resolve()
    provider.on('sync', check)
  })
  return { doc, text: doc.getText('content'), provider, synced }
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
    b.provider.connect()
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

  it('closes for good on a bad token', async () => {
    const ana = await user()
    const { id } = await api<{ id: string }>('/api/docs', { title: 'E2E' }, ana)
    const c = connect(id, 'not-a-token')
    const closed = await new Promise<number>((resolve) =>
      c.provider.on('closed', ({ code }) => resolve(code)),
    )
    expect(closed).toBe(4401)
    expect(c.provider.shouldConnect).toBe(false)
  })
})
