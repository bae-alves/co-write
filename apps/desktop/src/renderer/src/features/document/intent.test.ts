import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { colorFor, createDocumentIntents } from './intent'
import { useDocument } from './model'
import type {
  ConnectionStatus,
  DocumentRepository,
  LocalSession,
  Peer,
  RemoteSession,
} from './repository'

function emitter<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => void>()
  return {
    on: (listener: (...args: T) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit: (...args: T) => listeners.forEach((listener) => listener(...args)),
    get size() {
      return listeners.size
    },
  }
}

function fakeBase(initial: string) {
  const doc = new Y.Doc()
  const ytext = doc.getText('content')
  ytext.insert(0, initial)
  const changes = emitter<[string]>()
  ytext.observe(() => changes.emit(ytext.toString()))
  return {
    binding: { ytext, awareness: new Awareness(doc), undoManager: new Y.UndoManager(ytext) },
    text: () => ytext.toString(),
    onTextChange: changes.on,
    replaceText: (text: string) => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, text)
    },
    close: vi.fn(async () => {}),
    type: (text: string) => ytext.insert(ytext.length, text),
  }
}

function fakeLocal(path: string, disk: string) {
  const base = fakeBase(disk)
  let baseText = disk
  let onDisk = disk
  const session = {
    ...base,
    kind: 'local' as const,
    path,
    baseText: () => baseText,
    save: vi.fn(async () => {
      onDisk = base.text()
      baseText = onDisk
    }),
    readDisk: async () => onDisk,
    reload: (text: string) => {
      base.replaceText(text)
      baseText = text
    },
    setDisk: (text: string) => (onDisk = text),
  }
  return session satisfies LocalSession
}

function fakeRemote(docId: string, initial = '') {
  const base = fakeBase(initial)
  const status = emitter<[ConnectionStatus]>()
  const synced = emitter<[]>()
  const closed = emitter<[number, string]>()
  const peers = emitter<[readonly Peer[]]>()
  const session = {
    ...base,
    kind: 'remote' as const,
    docId,
    onStatus: status.on,
    onSynced: synced.on,
    onClosed: closed.on,
    onPeers: peers.on,
    status,
    synced,
    closed,
    peers,
  }
  return session satisfies RemoteSession
}

const state = () => useDocument.getState().state

function setup(options: { repository?: Partial<DocumentRepository>; token?: string | null } = {}) {
  const preview = { textChanged: vi.fn(), clear: vi.fn() }
  const sessionRejected = vi.fn()
  const repository: DocumentRepository = {
    openLocal: async (path) => fakeLocal(path, '# disk'),
    openRemote: async (docId) => fakeRemote(docId),
    ...options.repository,
  }
  const token = options.token === undefined ? 'tok' : options.token
  const intents = createDocumentIntents({
    model: useDocument,
    repository,
    identity: () => ({ username: token ? 'ana' : null, token }),
    preview,
    sessionRejected,
  })
  return { intents, preview, sessionRejected }
}

beforeEach(() => {
  useDocument.setState(useDocument.getInitialState(), true)
})

describe('local documents', () => {
  it('opens a file, shows it in the preview and exposes the binding', async () => {
    const { intents, preview } = setup()
    await intents.openLocal('notes/a.md')
    expect(state()).toMatchObject({
      tag: 'local',
      title: 'a.md',
      ref: { kind: 'local', path: 'notes/a.md' },
      dirty: false,
    })
    expect(preview.textChanged).toHaveBeenCalledWith('# disk')
    expect(intents.binding()?.ytext.toString()).toBe('# disk')
  })

  it('tracks dirtiness and clears it on save', async () => {
    const session = fakeLocal('a.md', 'x')
    const { intents, preview } = setup({ repository: { openLocal: async () => session } })
    await intents.openLocal('a.md')
    session.type('y')
    expect(state()).toMatchObject({ dirty: true })
    expect(preview.textChanged).toHaveBeenLastCalledWith('xy')
    await intents.save()
    expect(session.save).toHaveBeenCalled()
    expect(state()).toMatchObject({ dirty: false, saving: false })
  })

  it('reports a failed save and stays dirty', async () => {
    const session = fakeLocal('a.md', 'x')
    session.save.mockRejectedValueOnce(new Error('disk full'))
    const { intents } = setup({ repository: { openLocal: async () => session } })
    await intents.openLocal('a.md')
    session.type('y')
    await intents.save()
    expect(state()).toMatchObject({ dirty: true, saving: false, saveError: 'disk full' })
  })

  it('reloads a clean file that changed on disk', async () => {
    const session = fakeLocal('a.md', 'old')
    const { intents } = setup({ repository: { openLocal: async () => session } })
    await intents.openLocal('a.md')
    session.setDisk('new')
    await intents.fileChangedOnDisk('a.md')
    expect(session.text()).toBe('new')
    expect(state()).toMatchObject({ dirty: false, diskChanged: false })
  })

  it('keeps unsaved edits when the file changes on disk, and flags it', async () => {
    const session = fakeLocal('a.md', 'old')
    const { intents } = setup({ repository: { openLocal: async () => session } })
    await intents.openLocal('a.md')
    session.type('!')
    session.setDisk('theirs')
    await intents.fileChangedOnDisk('a.md')
    expect(session.text()).toBe('old!')
    expect(state()).toMatchObject({ dirty: true, diskChanged: true })
  })

  it('ignores change events caused by its own save', async () => {
    const session = fakeLocal('a.md', 'old')
    const { intents } = setup({ repository: { openLocal: async () => session } })
    await intents.openLocal('a.md')
    session.type('!')
    await intents.save()
    await intents.fileChangedOnDisk('a.md')
    expect(state()).toMatchObject({ dirty: false, diskChanged: false })
  })

  it('reports files that cannot be opened', async () => {
    const { intents } = setup({
      repository: {
        openLocal: async () => {
          throw new Error('Path is outside the project')
        },
      },
    })
    await intents.openLocal('../x.md')
    expect(state()).toMatchObject({ tag: 'failed', reason: 'Path is outside the project' })
  })

  it('closes the previous document when another one opens', async () => {
    const first = fakeLocal('a.md', 'a')
    const second = fakeLocal('b.md', 'b')
    const sessions = [first, second]
    const { intents } = setup({ repository: { openLocal: async () => sessions.shift()! } })
    await intents.openLocal('a.md')
    await intents.openLocal('b.md')
    expect(first.close).toHaveBeenCalled()
    expect(state()).toMatchObject({ title: 'b.md' })
  })

  it('lets the last of two overlapping opens win', async () => {
    let releaseFirst!: () => void
    const first = fakeLocal('a.md', 'a')
    const { intents } = setup({
      repository: {
        openLocal: (path) =>
          path === 'a.md'
            ? new Promise((resolve) => (releaseFirst = () => resolve(first)))
            : Promise.resolve(fakeLocal(path, 'b')),
      },
    })
    const slow = intents.openLocal('a.md')
    await new Promise((resolve) => setTimeout(resolve)) // the first open is now waiting on disk
    await intents.openLocal('b.md')
    releaseFirst()
    await slow
    expect(state()).toMatchObject({ tag: 'local', title: 'b.md' })
    expect(first.close).toHaveBeenCalled()
  })
})

describe('remote documents', () => {
  it('needs a signed-in user', async () => {
    const { intents } = setup({ token: null })
    await intents.openRemote('d1', 'Doc', 'editor')
    expect(state()).toMatchObject({ tag: 'failed', reason: 'Sign in to open shared documents.' })
  })

  it('goes connecting → synced → offline → synced', async () => {
    const session = fakeRemote('d1')
    const { intents } = setup({ repository: { openRemote: async () => session } })
    await intents.openRemote('d1', 'Doc', 'editor')
    expect(state()).toMatchObject({ tag: 'connecting', role: 'editor', title: 'Doc' })
    session.synced.emit()
    expect(state().tag).toBe('synced')
    session.status.emit('disconnected')
    expect(state().tag).toBe('offline')
    session.status.emit('connecting')
    expect(state().tag).toBe('offline')
    session.synced.emit()
    expect(state().tag).toBe('synced')
  })

  it('shows who else is in the document', async () => {
    const session = fakeRemote('d1')
    const { intents } = setup({ repository: { openRemote: async () => session } })
    await intents.openRemote('d1', 'Doc', 'editor')
    session.peers.emit([{ clientId: 7, name: 'bo', color: '#fff' }])
    expect(state()).toMatchObject({ peers: [{ clientId: 7, name: 'bo' }] })
  })

  it('seeds an empty document once, after the first sync', async () => {
    const session = fakeRemote('d1')
    const { intents } = setup({ repository: { openRemote: async () => session } })
    await intents.openRemote('d1', 'Doc', 'owner', '# from file')
    expect(session.text()).toBe('')
    session.synced.emit()
    expect(session.text()).toBe('# from file')
    session.replaceText('edited')
    session.synced.emit()
    expect(session.text()).toBe('edited')
  })

  it('does not seed a document that turned out to have content', async () => {
    const session = fakeRemote('d1', 'existing')
    const { intents } = setup({ repository: { openRemote: async () => session } })
    await intents.openRemote('d1', 'Doc', 'owner', 'seed')
    session.synced.emit()
    expect(session.text()).toBe('existing')
  })

  it('stops for good when the server rejects the session', async () => {
    const session = fakeRemote('d1')
    const { intents, sessionRejected } = setup({
      repository: { openRemote: async () => session },
    })
    await intents.openRemote('d1', 'Doc', 'editor')
    session.closed.emit(4401, '')
    expect(state()).toMatchObject({ tag: 'closed', reason: expect.stringContaining('expired') })
    expect(sessionRejected).toHaveBeenCalled()
  })

  it('explains a revoked access', async () => {
    const session = fakeRemote('d1')
    const { intents, sessionRejected } = setup({
      repository: { openRemote: async () => session },
    })
    await intents.openRemote('d1', 'Doc', 'editor')
    session.closed.emit(4403, '')
    expect(state()).toMatchObject({ tag: 'closed', reason: expect.stringContaining('access') })
    expect(sessionRejected).not.toHaveBeenCalled()
  })

  it('unsubscribes and clears the preview on close', async () => {
    const session = fakeRemote('d1')
    const { intents, preview } = setup({ repository: { openRemote: async () => session } })
    await intents.openRemote('d1', 'Doc', 'editor')
    await intents.close()
    expect(session.close).toHaveBeenCalled()
    expect(session.synced.size).toBe(0)
    expect(preview.clear).toHaveBeenCalled()
    expect(state()).toEqual({ tag: 'empty' })
    expect(intents.binding()).toBeNull()
  })
})

describe('colorFor', () => {
  it('is stable per name', () => {
    expect(colorFor('ana')).toBe(colorFor('ana'))
    expect(colorFor('ana')).toMatch(/^#[0-9A-F]{6}$/)
  })
})
