import { COLLAB_PATH, type DocRef } from '@co-write/shared'
import { Awareness } from 'y-protocols/awareness'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { desktopApi, SERVER_URL } from '@/server/repository'

/** What CodeMirror binds to. The Y.Doc itself never leaves this file. */
export interface Binding {
  readonly ytext: Y.Text
  readonly awareness: Awareness
  readonly undoManager: Y.UndoManager
}

export interface UserInfo {
  readonly name: string
  readonly color: string
}

export interface Peer extends UserInfo {
  readonly clientId: number
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

interface BaseSession {
  readonly binding: Binding
  text(): string
  /** Fires after every change, local or remote. Returns an unsubscribe function. */
  onTextChange(listener: (text: string) => void): () => void
  /** Replaces the whole text in one transaction that undo does not track. */
  replaceText(text: string): void
  /** Stops syncing and flushes the locally persisted state. */
  close(): Promise<void>
}

export interface LocalSession extends BaseSession {
  readonly kind: 'local'
  readonly path: string
  /** The file content as last read from or written to disk. */
  baseText(): string
  save(): Promise<void>
  readDisk(): Promise<string>
  /** Adopts `text` as both the content and the new on-disk base. */
  reload(text: string): void
}

export interface RemoteSession extends BaseSession {
  readonly kind: 'remote'
  readonly docId: string
  onStatus(listener: (status: ConnectionStatus) => void): () => void
  onSynced(listener: () => void): () => void
  /** The server ended the session for good (4401/4403/4404); no reconnect follows. */
  onClosed(listener: (code: number, reason: string) => void): () => void
  onPeers(listener: (peers: readonly Peer[]) => void): () => void
}

export interface DocumentRepository {
  openLocal(path: string, user: UserInfo): Promise<LocalSession>
  openRemote(docId: string, token: string, user: UserInfo): Promise<RemoteSession>
}

/** Transaction origins. Only edits made through CodeMirror are undoable. */
const DISK = Symbol('disk')
const PERSISTENCE = Symbol('persistence')
const PERSIST_DELAY_MS = 400

/** The document text and, for local files, the on-disk base the draft was started from. */
const TEXT = 'content'
const META = 'meta'

function newBinding(doc: Y.Doc, user: UserInfo): Binding {
  const awareness = new Awareness(doc)
  awareness.setLocalStateField('user', {
    name: user.name,
    color: user.color,
    colorLight: `${user.color}33`,
  })
  const ytext = doc.getText(TEXT)
  // Tracked origins are added by the CodeMirror binding (y-codemirror.next).
  const undoManager = new Y.UndoManager(ytext, { trackedOrigins: new Set() })
  return { ytext, awareness, undoManager }
}

/** Saves the doc's Yjs state through main, at most every 400 ms while it changes. */
function persistDoc(doc: Y.Doc, ref: DocRef) {
  const api = desktopApi()
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  const flush = async () => {
    clearTimeout(timer)
    timer = undefined
    if (!dirty || !api) return
    dirty = false
    await api.storeDocState(ref, Y.encodeStateAsUpdate(doc)).catch(() => {
      dirty = true
    })
  }
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === PERSISTENCE) return
    dirty = true
    timer ??= setTimeout(() => void flush(), PERSIST_DELAY_MS)
  }
  doc.on('update', onUpdate)
  return {
    load: async () => {
      const state = await api?.loadDocState(ref).catch(() => null)
      if (state) Y.applyUpdate(doc, state, PERSISTENCE)
      return Boolean(state)
    },
    close: async () => {
      doc.off('update', onUpdate)
      await flush()
    },
  }
}

function baseSession(doc: Y.Doc, binding: Binding, persistence: { close(): Promise<void> }) {
  return {
    binding,
    text: () => binding.ytext.toString(),
    onTextChange(listener: (text: string) => void) {
      const observer = () => listener(binding.ytext.toString())
      binding.ytext.observe(observer)
      return () => binding.ytext.unobserve(observer)
    },
    replaceText(text: string) {
      doc.transact(() => {
        binding.ytext.delete(0, binding.ytext.length)
        binding.ytext.insert(0, text)
      }, DISK)
    },
    async close() {
      binding.awareness.setLocalState(null)
      binding.awareness.destroy()
      binding.undoManager.destroy()
      await persistence.close()
      doc.destroy()
    },
  }
}

function requireApi() {
  const api = desktopApi()
  if (!api) throw new Error('Local files need the desktop app')
  return api
}

export function createDocumentRepository(serverUrl: string): DocumentRepository {
  const wsBase = new URL(COLLAB_PATH, serverUrl.replace(/^http/, 'ws')).href

  return {
    async openLocal(path, user) {
      const api = requireApi()
      const disk = await api.readFile(path)
      const doc = new Y.Doc()
      const persistence = persistDoc(doc, { kind: 'local', path })
      await persistence.load()
      const meta = doc.getMap<string>(META)
      // A saved draft only applies to the file content it was started from.
      if (meta.get('base') !== disk) {
        doc.transact(() => {
          const ytext = doc.getText(TEXT)
          ytext.delete(0, ytext.length)
          ytext.insert(0, disk)
          meta.set('base', disk)
        }, DISK)
      }
      const binding = newBinding(doc, user)
      const base = baseSession(doc, binding, persistence)
      return {
        ...base,
        kind: 'local',
        path,
        baseText: () => meta.get('base') ?? '',
        async save() {
          const text = binding.ytext.toString()
          await api.saveFile(path, text)
          doc.transact(() => meta.set('base', text), DISK)
        },
        readDisk: () => api.readFile(path),
        reload(text) {
          doc.transact(() => {
            base.replaceText(text)
            meta.set('base', text)
          }, DISK)
        },
      }
    },

    async openRemote(docId, token, user) {
      const doc = new Y.Doc()
      const persistence = persistDoc(doc, { kind: 'remote', docId })
      await persistence.load()
      const binding = newBinding(doc, user)
      const provider = new WebsocketProvider(wsBase, encodeURIComponent(docId), doc, {
        params: { token },
        awareness: binding.awareness,
        disableBc: true,
        maxBackoffTime: 10_000,
      })
      const base = baseSession(doc, binding, persistence)

      const peers = (): Peer[] =>
        [...binding.awareness.getStates()]
          .filter(([clientId]) => clientId !== doc.clientID)
          .flatMap(([clientId, state]) => {
            const peer = (state as { user?: Partial<UserInfo> }).user
            return peer?.name && peer.color
              ? [{ clientId, name: peer.name, color: peer.color }]
              : []
          })

      return {
        ...base,
        kind: 'remote',
        docId,
        onStatus(listener) {
          const handler = ({ status }: { status: ConnectionStatus }) => listener(status)
          provider.on('status', handler)
          return () => provider.off('status', handler)
        },
        onSynced(listener) {
          const handler = (synced: boolean) => synced && listener()
          provider.on('sync', handler)
          return () => provider.off('sync', handler)
        },
        onClosed(listener) {
          const handler = ({ code, reason }: { code: number; reason: string }) =>
            listener(code, reason)
          provider.on('closed', handler)
          return () => provider.off('closed', handler)
        },
        onPeers(listener) {
          const handler = () => listener(peers())
          binding.awareness.on('change', handler)
          return () => binding.awareness.off('change', handler)
        },
        async close() {
          provider.destroy()
          await base.close()
        },
      }
    },
  }
}

export const documentRepository = createDocumentRepository(SERVER_URL)
