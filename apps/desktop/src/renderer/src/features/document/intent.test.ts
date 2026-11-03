import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { colorFor, createDocumentIntents } from './intent'
import { useDocument, useTabs } from './model'
import type {
  ConnectionStatus,
  DocumentRepository,
  LocalSession,
  Peer,
  RemoteSession,
  ViewSession,
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

function fakeView(path: string, initial = [1, 2, 3]) {
  let bytes = new Uint8Array(initial)
  let onDisk = bytes
  const session: ViewSession = {
    kind: 'view',
    path,
    bytes: () => bytes,
    reload: vi.fn(async () => (bytes = onDisk)),
    close: vi.fn(async () => {}),
  }
  return Object.assign(session, { setDisk: (next: number[]) => (onDisk = new Uint8Array(next)) })
}

const state = () => useDocument.getState().state
const tabs = () => {
  const now = useTabs.getState().state
  return now.tag === 'open'
    ? { titles: now.tabs.map((tab) => tab.title), active: now.active }
    : null
}

function setup(
  options: { repository?: Partial<DocumentRepository>; token?: string | null; open?: boolean } = {},
) {
  const open = options.open ?? false
  const preview = { show: vi.fn(), textChanged: vi.fn(), clear: vi.fn() }
  const sessionRejected = vi.fn()
  const repository: DocumentRepository = {
    openLocal: async (path) => fakeLocal(path, '# disk'),
    openView: async (path) => fakeView(path),
    openRemote: async (docId) => fakeRemote(docId),
    ...options.repository,
  }
  const token = options.token === undefined ? 'tok' : options.token
  const intents = createDocumentIntents({
    model: useDocument,
    tabs: useTabs,
    repository,
    identity: () => ({ username: token ? 'ana' : null, token, open }),
    preview,
    sessionRejected,
  })
  return { intents, preview, sessionRejected }
}

beforeEach(() => {
  useDocument.setState(useDocument.getInitialState(), true)
  useTabs.setState(useTabs.getInitialState(), true)
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
    expect(preview.show).toHaveBeenCalledWith({ kind: 'markdown', text: '# disk' })
    expect(intents.binding()?.ytext.toString()).toBe('# disk')
    expect(tabs()).toEqual({ titles: ['a.md'], active: 'local:notes/a.md' })
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

  it('keeps the previous document open in its own tab', async () => {
    const first = fakeLocal('a.md', 'a')
    const second = fakeLocal('b.md', 'b')
    const sessions = [first, second]
    const { intents } = setup({ repository: { openLocal: async () => sessions.shift()! } })
    await intents.openLocal('a.md')
    await intents.openLocal('b.md')
    expect(first.close).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ title: 'b.md' })
    expect(tabs()).toEqual({ titles: ['a.md', 'b.md'], active: 'local:b.md' })
  })

  it('shows every tab its own state when switching', async () => {
    const first = fakeLocal('a.md', 'a')
    const second = fakeLocal('b.md', 'b')
    const sessions = [first, second]
    const { intents, preview } = setup({ repository: { openLocal: async () => sessions.shift()! } })
    await intents.openLocal('a.md')
    first.type('!')
    await intents.openLocal('b.md')
    expect(state()).toMatchObject({ title: 'b.md', dirty: false })

    intents.activate('local:a.md')
    expect(state()).toMatchObject({ title: 'a.md', dirty: true })
    expect(preview.show).toHaveBeenLastCalledWith({ kind: 'markdown', text: 'a!' })
    expect(intents.binding()).toBe(first.binding)
    expect(intents.binding('local:b.md')).toBe(second.binding)
  })

  it('switches to an open file instead of opening it twice', async () => {
    const open = vi.fn(async (path: string) => fakeLocal(path, 'x'))
    const { intents } = setup({ repository: { openLocal: open } })
    await intents.openLocal('a.md')
    await intents.openLocal('b.md')
    await intents.openLocal('a.md')
    expect(open).toHaveBeenCalledTimes(2)
    expect(tabs()).toEqual({ titles: ['a.md', 'b.md'], active: 'local:a.md' })
  })

  it('previews only the active tab', async () => {
    const first = fakeLocal('a.md', 'a')
    const second = fakeLocal('b.md', 'b')
    const sessions = [first, second]
    const { intents, preview } = setup({ repository: { openLocal: async () => sessions.shift()! } })
    await intents.openLocal('a.md')
    await intents.openLocal('b.md')
    preview.textChanged.mockClear()
    first.type('background edit')
    expect(preview.textChanged).not.toHaveBeenCalled()
    second.type('!')
    expect(preview.textChanged).toHaveBeenCalledWith('b!')
  })

  it('marks a background tab dirty', async () => {
    const first = fakeLocal('a.md', 'a')
    const second = fakeLocal('b.md', 'b')
    const sessions = [first, second]
    const { intents } = setup({ repository: { openLocal: async () => sessions.shift()! } })
    await intents.openLocal('a.md')
    await intents.openLocal('b.md')
    first.type('!')
    const now = useTabs.getState().state
    expect(now.tag === 'open' && now.tabs.map((tab) => tab.dirty)).toEqual([true, false])
  })

  it('opens both when two opens overlap, and the last request is the one showing', async () => {
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
    expect(tabs()).toEqual({ titles: ['a.md', 'b.md'], active: 'local:b.md' })
    expect(first.close).not.toHaveBeenCalled()
  })

  it('closes a tab opened while it was closed again', async () => {
    let release!: () => void
    const slow = fakeLocal('a.md', 'a')
    const { intents } = setup({
      repository: { openLocal: () => new Promise((resolve) => (release = () => resolve(slow))) },
    })
    const opening = intents.openLocal('a.md')
    await new Promise((resolve) => setTimeout(resolve))
    await intents.closeTab('local:a.md')
    release()
    await opening
    expect(slow.close).toHaveBeenCalled()
    expect(tabs()).toBeNull()
    expect(state()).toEqual({ tag: 'empty' })
  })

  it('retries a failed open when its file is clicked again', async () => {
    const open = vi
      .fn<(path: string) => Promise<LocalSession>>()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce(fakeLocal('a.md', 'x'))
    const { intents } = setup({ repository: { openLocal: open } })
    await intents.openLocal('a.md')
    expect(state()).toMatchObject({ tag: 'failed', reason: 'nope' })
    await intents.openLocal('a.md')
    expect(state()).toMatchObject({ tag: 'local' })
    expect(tabs()).toEqual({ titles: ['a.md'], active: 'local:a.md' })
  })

  it('reloads a file that changed on disk while its tab is in the background', async () => {
    const first = fakeLocal('a.md', 'old')
    const second = fakeLocal('b.md', 'b')
    const sessions = [first, second]
    const { intents } = setup({ repository: { openLocal: async () => sessions.shift()! } })
    await intents.openLocal('a.md')
    await intents.openLocal('b.md')
    first.setDisk('new')
    await intents.fileChangedOnDisk('a.md')
    expect(first.text()).toBe('new')
    expect(state()).toMatchObject({ title: 'b.md' })
  })

  it('saves the active tab only', async () => {
    const first = fakeLocal('a.md', 'a')
    const second = fakeLocal('b.md', 'b')
    const sessions = [first, second]
    const { intents } = setup({ repository: { openLocal: async () => sessions.shift()! } })
    await intents.openLocal('a.md')
    await intents.openLocal('b.md')
    second.type('!')
    await intents.save()
    expect(second.save).toHaveBeenCalled()
    expect(first.save).not.toHaveBeenCalled()
  })
})

describe('tabs', () => {
  const open = async (names: string[]) => {
    const created = new Map<string, ReturnType<typeof fakeLocal>>()
    const { intents, preview } = setup({
      repository: {
        openLocal: async (path) => {
          const session = fakeLocal(path, path)
          created.set(path, session)
          return session
        },
      },
    })
    for (const name of names) await intents.openLocal(name)
    return { intents, preview, created }
  }

  it('closes the active tab and shows its right neighbour, else the left one', async () => {
    const { intents, created } = await open(['a.md', 'b.md', 'c.md'])
    intents.activate('local:b.md')
    await intents.closeTab()
    expect(created.get('b.md')!.close).toHaveBeenCalled()
    expect(tabs()).toEqual({ titles: ['a.md', 'c.md'], active: 'local:c.md' })
    expect(state()).toMatchObject({ title: 'c.md' })
    await intents.closeTab()
    expect(tabs()).toEqual({ titles: ['a.md'], active: 'local:a.md' })
  })

  it('closes a background tab without leaving the active one', async () => {
    const { intents } = await open(['a.md', 'b.md'])
    await intents.closeTab('local:a.md')
    expect(tabs()).toEqual({ titles: ['b.md'], active: 'local:b.md' })
    expect(state()).toMatchObject({ title: 'b.md' })
  })

  it('goes back to empty after the last tab closes', async () => {
    const { intents, preview } = await open(['a.md'])
    await intents.closeTab()
    expect(state()).toEqual({ tag: 'empty' })
    expect(tabs()).toBeNull()
    expect(preview.clear).toHaveBeenCalled()
    expect(intents.binding()).toBeNull()
  })

  it('cycles through the tabs and wraps around', async () => {
    const { intents } = await open(['a.md', 'b.md', 'c.md'])
    intents.cycle(1)
    expect(tabs()?.active).toBe('local:a.md')
    intents.cycle(-1)
    expect(tabs()?.active).toBe('local:c.md')
    intents.cycle(-1)
    expect(tabs()?.active).toBe('local:b.md')
  })

  it('closes everything on close()', async () => {
    const { intents, created } = await open(['a.md', 'b.md'])
    await intents.close()
    expect(created.get('a.md')!.close).toHaveBeenCalled()
    expect(created.get('b.md')!.close).toHaveBeenCalled()
    expect(state()).toEqual({ tag: 'empty' })
    expect(tabs()).toBeNull()
  })
})

describe('file types', () => {
  it('edits other text formats without a Markdown preview', async () => {
    const { intents, preview } = setup()
    await intents.openLocal('config/app.yaml')
    expect(state()).toMatchObject({
      tag: 'local',
      fileKind: { preview: 'none', binary: false },
    })
    expect(preview.show).not.toHaveBeenCalled()
    expect(preview.clear).toHaveBeenCalled()
  })

  it('previews RTF as RTF', async () => {
    const { intents, preview } = setup({
      repository: { openLocal: async (path) => fakeLocal(path, '{\\rtf1 hi\\par}') },
    })
    await intents.openLocal('letter.rtf')
    expect(preview.show).toHaveBeenCalledWith({ kind: 'rtf', text: '{\\rtf1 hi\\par}' })
  })

  it('clears the preview when switching to a file that has none', async () => {
    const { intents, preview } = setup()
    await intents.openLocal('a.md')
    await intents.openLocal('data.json')
    expect(preview.clear).toHaveBeenCalled()
    preview.clear.mockClear()
    intents.activate('local:a.md')
    expect(preview.clear).not.toHaveBeenCalled()
    expect(preview.show).toHaveBeenLastCalledWith({ kind: 'markdown', text: '# disk' })
  })

  it('shows a PDF without an editing session', async () => {
    const { intents, preview } = setup()
    await intents.openLocal('docs/paper.pdf')
    expect(state()).toMatchObject({ tag: 'viewing', title: 'paper.pdf' })
    expect(preview.show).toHaveBeenCalledWith({ kind: 'pdf', data: new Uint8Array([1, 2, 3]) })
    expect(intents.binding()).toBeNull()
    expect(intents.text()).toBeNull()
    const now = useTabs.getState().state
    expect(now.tag === 'open' && now.tabs[0]!.session).toBeNull()
  })

  it('re-reads a PDF that changed on disk', async () => {
    const view = fakeView('paper.pdf')
    const { intents, preview } = setup({ repository: { openView: async () => view } })
    await intents.openLocal('paper.pdf')
    view.setDisk([9, 9])
    await intents.fileChangedOnDisk('paper.pdf')
    expect(preview.show).toHaveBeenLastCalledWith({ kind: 'pdf', data: new Uint8Array([9, 9]) })
  })

  it('treats a shared document by its title: data.json is JSON, plain titles are Markdown', async () => {
    const { intents } = setup()
    await intents.openRemote('d1', 'data.json', 'editor')
    expect(state()).toMatchObject({ fileKind: { preview: 'none' } })
    await intents.openRemote('d2', 'Meeting notes', 'editor')
    expect(state()).toMatchObject({ fileKind: { preview: 'markdown' } })
    await intents.openRemote('d3', 'sneaky.pdf', 'editor')
    expect(state()).toMatchObject({ fileKind: { preview: 'markdown', binary: false } })
  })
})

describe('remote documents', () => {
  it('needs a signed-in user', async () => {
    const { intents } = setup({ token: null })
    await intents.openRemote('d1', 'Doc', 'editor')
    expect(state()).toMatchObject({ tag: 'failed', reason: 'Sign in to open shared documents.' })
  })

  it('opens shared documents on an open instance without a token', async () => {
    const openRemote = vi.fn(async (docId: string) => fakeRemote(docId))
    const { intents } = setup({ token: null, open: true, repository: { openRemote } })
    await intents.openRemote('d1', 'Doc', 'editor')
    expect(openRemote).toHaveBeenCalledWith('d1', null, expect.anything())
    expect(state()).toMatchObject({ tag: 'connecting' })
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

  it('keeps syncing in the background and closes only shared documents on sign-out', async () => {
    const remote = fakeRemote('d1')
    const local = fakeLocal('a.md', 'a')
    const { intents } = setup({
      repository: { openRemote: async () => remote, openLocal: async () => local },
    })
    await intents.openRemote('d1', 'Doc', 'editor')
    await intents.openLocal('a.md')
    remote.synced.emit()
    expect(state()).toMatchObject({ title: 'a.md' }) // the background tab does not take over
    intents.activate('remote:d1')
    expect(state().tag).toBe('synced')
    await intents.closeRemote()
    expect(remote.close).toHaveBeenCalled()
    expect(local.close).not.toHaveBeenCalled()
    expect(tabs()).toEqual({ titles: ['a.md'], active: 'local:a.md' })
    expect(state()).toMatchObject({ tag: 'local' })
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
