// @vitest-environment jsdom
import type { CoWriteApi, DocRef } from '@co-write/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/server/repository'
import { connectWithTickets, createDocumentRepository, type TicketedProvider } from './repository'

const user = { name: 'ana', color: '#FFB0CB' }

let files: Map<string, string>
let states: Map<string, Uint8Array>
const key = (ref: DocRef) => (ref.kind === 'local' ? `l:${ref.path}` : `r:${ref.docId}`)

beforeEach(() => {
  vi.useFakeTimers()
  files = new Map([['a.md', '# disk']])
  states = new Map()
  const api: Partial<CoWriteApi> = {
    readFile: async (path) => files.get(path) ?? Promise.reject(new Error('ENOENT')),
    saveFile: async (path, content) => void files.set(path, content),
    loadDocState: async (ref) => states.get(key(ref)) ?? null,
    storeDocState: async (ref, state) => void states.set(key(ref), state),
  }
  Object.assign(window, { api })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'api')
})

const repository = createDocumentRepository(() => 'http://localhost:8080')

describe('local sessions', () => {
  it('starts from the file on disk', async () => {
    const session = await repository.openLocal('a.md', user)
    expect(session.text()).toBe('# disk')
    expect(session.baseText()).toBe('# disk')
    await session.close()
  })

  it('keeps unsaved edits across restarts', async () => {
    const first = await repository.openLocal('a.md', user)
    first.binding.ytext.insert(first.binding.ytext.length, ' draft')
    await first.close() // flushes the persisted state

    const second = await repository.openLocal('a.md', user)
    expect(second.text()).toBe('# disk draft')
    expect(second.baseText()).toBe('# disk')
    await second.close()
  })

  it('drops a saved draft when the file changed on disk since', async () => {
    const first = await repository.openLocal('a.md', user)
    first.binding.ytext.insert(0, 'draft ')
    await first.close()
    files.set('a.md', 'edited elsewhere')

    const second = await repository.openLocal('a.md', user)
    expect(second.text()).toBe('edited elsewhere')
    await second.close()
  })

  it('saves to disk and moves the base', async () => {
    const session = await repository.openLocal('a.md', user)
    session.binding.ytext.insert(0, '> ')
    await session.save()
    expect(files.get('a.md')).toBe('> # disk')
    expect(session.baseText()).toBe('> # disk')
    await session.close()
  })

  it('persists in the background, debounced', async () => {
    const session = await repository.openLocal('a.md', user)
    session.binding.ytext.insert(0, 'x')
    expect(states.size).toBe(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(states.size).toBe(1)
    await session.close()
  })

  it('does not put disk loads or reloads on the undo stack', async () => {
    const session = await repository.openLocal('a.md', user)
    session.reload('from disk again')
    expect(session.binding.undoManager.undoStack).toHaveLength(0)
    expect(session.text()).toBe('from disk again')
    expect(session.baseText()).toBe('from disk again')
    await session.close()
  })
})

/** A provider that records what it is told, and lets the test play the server's part. */
function fakeProvider() {
  const handlers = new Map<string, ((...args: never[]) => void)[]>()
  const provider = {
    params: {} as Record<string, string>,
    shouldConnect: true,
    connects: [] as Record<string, string>[],
    emitted: [] as [string, unknown[]][],
    connect() {
      provider.shouldConnect = true
      provider.connects.push(provider.params)
    },
    on: (event: string, handler: (...args: never[]) => void) =>
      void handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    off: (event: string, handler: (...args: never[]) => void) =>
      void handlers.set(
        event,
        (handlers.get(event) ?? []).filter((h) => h !== handler),
      ),
    emit: (event: string, args: unknown[]) => {
      provider.emitted.push([event, args])
      ;(handlers.get(event) ?? []).forEach((handler) =>
        (handler as (...a: unknown[]) => void)(...args),
      )
    },
    drop: (code = 1006) => provider.emit('connection-close', [{ code }, provider]),
  }
  return provider
}

const settle = () => vi.advanceTimersByTimeAsync(0)

describe('connectWithTickets', () => {
  it('connects with a fresh ticket, and again with another after every drop', async () => {
    const provider = fakeProvider()
    let n = 0
    connectWithTickets(provider as unknown as TicketedProvider, async () => `ticket-${++n}`)
    await settle()
    expect(provider.connects).toEqual([{ ticket: 'ticket-1' }])

    provider.drop()
    expect(provider.shouldConnect).toBe(false) // y-websocket's own reconnect is switched off
    await vi.advanceTimersByTimeAsync(400)
    expect(provider.connects).toEqual([{ ticket: 'ticket-1' }, { ticket: 'ticket-2' }])
  })

  it('needs no ticket on an open instance', async () => {
    const provider = fakeProvider()
    connectWithTickets(provider as unknown as TicketedProvider, async () => null)
    await settle()
    expect(provider.connects).toEqual([{}])
  })

  it('does not reconnect after a final close code, and leaves the report to y-websocket', async () => {
    const provider = fakeProvider()
    connectWithTickets(provider as unknown as TicketedProvider, async () => 't')
    await settle()
    provider.drop(4403)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(provider.connects).toHaveLength(1)
    expect(provider.shouldConnect).toBe(false)
  })

  it('reconnects after a role change, which is not final', async () => {
    const provider = fakeProvider()
    connectWithTickets(provider as unknown as TicketedProvider, async () => 't')
    await settle()
    provider.drop(4001)
    await vi.advanceTimersByTimeAsync(400)
    expect(provider.connects).toHaveLength(2)
  })

  it('backs off while the server is down, and reports offline', async () => {
    const provider = fakeProvider()
    let up = false
    connectWithTickets(provider as unknown as TicketedProvider, async () => {
      if (!up) throw new ApiError(0, 'Server unreachable')
      return 't'
    })
    await settle()
    expect(provider.connects).toHaveLength(0)
    expect(provider.emitted.filter(([event]) => event === 'status').length).toBeGreaterThan(0)
    up = true
    await vi.advanceTimersByTimeAsync(10_000)
    expect(provider.connects).toHaveLength(1)
  })

  it('treats a ticket refused with 401, 403 or 404 as a final close', async () => {
    for (const [status, code] of [
      [401, 4401],
      [403, 4403],
      [404, 4404],
    ] as const) {
      const provider = fakeProvider()
      connectWithTickets(provider as unknown as TicketedProvider, async () => {
        throw new ApiError(status, 'nope')
      })
      await settle()
      expect(provider.connects).toHaveLength(0)
      const closed = provider.emitted.find(([event]) => event === 'closed')!
      expect(closed[1][0]).toEqual({ code, reason: 'nope' })
    }
  })

  it('stops for good when asked', async () => {
    const provider = fakeProvider()
    const connection = connectWithTickets(provider as unknown as TicketedProvider, async () => 't')
    await settle()
    connection.stop()
    provider.drop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(provider.connects).toHaveLength(1)
  })
})
