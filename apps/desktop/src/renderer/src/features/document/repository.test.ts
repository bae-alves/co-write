// @vitest-environment jsdom
import type { CoWriteApi, DocRef } from '@co-write/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocumentRepository } from './repository'

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

const repository = createDocumentRepository('http://localhost:8080')

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
