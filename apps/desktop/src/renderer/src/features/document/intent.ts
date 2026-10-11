import { CollabCloseCode, type Role } from '@co-write/shared'
import { accountIntents } from '@/features/account/intent'
import { useAccount } from '@/features/account/model'
import { previewIntents } from '@/features/preview/intent'
import {
  isRemoteOpen,
  useDocument,
  type DocumentState,
  type RemoteDocument,
  type RemoteOpen,
} from './model'
import {
  documentRepository,
  type Binding,
  type DocumentRepository,
  type LocalSession,
  type RemoteSession,
  type UserInfo,
} from './repository'

export interface DocumentDeps {
  readonly model: typeof useDocument
  readonly repository: DocumentRepository
  /** Who is editing: the signed-in user, if any, and their token. */
  readonly identity: () => { readonly username: string | null; readonly token: string | null }
  readonly preview: { textChanged(text: string): void; clear(): void }
  /** Called when the server says the session token is no longer valid. */
  readonly sessionRejected: () => void
}

/** Peer colours: the WolfRose accents, so cursors read well on the editor background. */
const COLORS = ['#FFB0CB', '#5EA9C8', '#E7AF55', '#A8E6B0', '#C4A7E7', '#85C3CE', '#F1A59C']

export function colorFor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]!
}

const basename = (path: string): string => path.split('/').pop() ?? path
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const CLOSE_REASONS: Record<number, string> = {
  [CollabCloseCode.unauthenticated]: 'Your session expired. Sign in again to keep editing.',
  [CollabCloseCode.forbidden]: 'You no longer have access to this document.',
  [CollabCloseCode.notFound]: 'This document no longer exists on the server.',
}

export function createDocumentIntents(deps: DocumentDeps) {
  const { model, repository, preview } = deps
  const go = (next: DocumentState) => model.getState().go(next)
  const state = () => model.getState().state

  let current: LocalSession | RemoteSession | null = null
  let unsubscribe: (() => void)[] = []
  let sessionCounter = 0

  const user = (): UserInfo => {
    const name = deps.identity().username ?? 'You'
    return { name, color: colorFor(name) }
  }

  async function closeCurrent(): Promise<void> {
    unsubscribe.forEach((stop) => stop())
    unsubscribe = []
    const closing = current
    current = null
    await closing?.close()
  }

  /** Runs `open` unless another open started meanwhile; a stale session is closed again. */
  async function begin<S extends LocalSession | RemoteSession>(
    loading: Extract<DocumentState, { tag: 'loading' }>,
    open: () => Promise<S>,
  ): Promise<{ session: S; id: number } | null> {
    const id = ++sessionCounter
    await closeCurrent()
    if (id !== sessionCounter) return null
    go(loading)
    let session: S
    try {
      session = await open()
    } catch (error) {
      if (id === sessionCounter) go({ ...loading, tag: 'failed', reason: message(error) })
      return null
    }
    if (id !== sessionCounter) {
      await session.close()
      return null
    }
    current = session
    preview.textChanged(session.text())
    return { session, id }
  }

  function updateRemote(update: (doc: RemoteOpen) => DocumentState | null) {
    const now = state()
    if (!isRemoteOpen(now)) return
    const next = update(now)
    if (next) go(next)
  }

  return {
    async openLocal(path: string): Promise<void> {
      const now = state()
      if (now.tag === 'local' && now.ref.path === path) return
      const ref = { kind: 'local' as const, path }
      const opened = await begin({ tag: 'loading', ref, title: basename(path) }, () =>
        repository.openLocal(path, user()),
      )
      if (!opened) return
      const { session, id } = opened
      const isDirty = () => session.text() !== session.baseText()
      go({
        tag: 'local',
        session: id,
        ref,
        title: basename(path),
        dirty: isDirty(),
        saving: false,
        diskChanged: false,
        saveError: null,
      })
      unsubscribe.push(
        session.onTextChange((text) => {
          preview.textChanged(text)
          const now = state()
          if (now.tag === 'local' && now.dirty !== isDirty()) go({ ...now, dirty: isDirty() })
        }),
      )
    },

    /**
     * Opens a server document. With `seed`, an empty document is filled with that text once
     * the first sync has shown it really is empty (used to publish a local file).
     */
    async openRemote(docId: string, title: string, role: Role, seed?: string): Promise<void> {
      const now = state()
      if (isRemoteOpen(now) && now.ref.docId === docId) return
      const ref = { kind: 'remote' as const, docId }
      const { token } = deps.identity()
      const opened = await begin({ tag: 'loading', ref, title }, async () => {
        if (!token) throw new Error('Sign in to open shared documents.')
        return repository.openRemote(docId, token, user())
      })
      if (!opened) return
      const { session, id } = opened
      const doc: RemoteDocument = { session: id, ref, title, role, peers: [] }
      go({ tag: 'connecting', ...doc })
      let seedPending = seed !== undefined && role !== 'viewer'

      unsubscribe.push(
        session.onTextChange((text) => preview.textChanged(text)),
        session.onSynced(() => {
          if (seedPending) {
            seedPending = false
            if (session.text() === '') session.replaceText(seed!)
          }
          updateRemote((now) => (now.tag === 'synced' ? null : { ...now, tag: 'synced' }))
        }),
        session.onStatus((status) => {
          if (status === 'disconnected') {
            updateRemote((now) => (now.tag === 'offline' ? null : { ...now, tag: 'offline' }))
          }
        }),
        session.onPeers((peers) => updateRemote((now) => ({ ...now, peers }))),
        session.onClosed((code, reason) => {
          if (code === CollabCloseCode.unauthenticated) deps.sessionRejected()
          updateRemote((now) => ({
            tag: 'closed',
            ref: now.ref,
            title: now.title,
            reason: CLOSE_REASONS[code] ?? (reason || 'The server closed this document.'),
          }))
        }),
      )
    },

    async save(): Promise<void> {
      const now = state()
      if (now.tag !== 'local' || now.saving || current?.kind !== 'local') return
      const session = current
      go({ ...now, saving: true, saveError: null })
      try {
        await session.save()
        const after = state()
        if (after.tag === 'local' && after.session === now.session) {
          go({
            ...after,
            saving: false,
            diskChanged: false,
            dirty: session.text() !== session.baseText(),
          })
        }
      } catch (error) {
        const after = state()
        if (after.tag === 'local' && after.session === now.session) {
          go({ ...after, saving: false, saveError: message(error) })
        }
      }
    },

    /** A file in the project changed on disk (possibly by our own save). */
    async fileChangedOnDisk(path: string): Promise<void> {
      const now = state()
      if (now.tag !== 'local' || now.ref.path !== path || current?.kind !== 'local') return
      const session = current
      const disk = await session.readDisk().catch(() => null)
      if (disk === null || disk === session.baseText() || current !== session) return
      const after = state()
      if (after.tag !== 'local') return
      if (!after.dirty) {
        session.reload(disk)
        go({ ...after, dirty: false, diskChanged: false })
      } else {
        go({ ...after, diskChanged: true })
      }
    },

    async close(): Promise<void> {
      sessionCounter++
      await closeCurrent()
      preview.clear()
      if (state().tag !== 'empty') go({ tag: 'empty' })
    },

    /** What the editor view binds to, or null when nothing is open. */
    binding(): Binding | null {
      return current?.binding ?? null
    },

    /** The text of the open document (e.g. to publish it). */
    text(): string | null {
      return current?.text() ?? null
    },
  }
}

export type DocumentIntents = ReturnType<typeof createDocumentIntents>

export const documentIntents = createDocumentIntents({
  model: useDocument,
  repository: documentRepository,
  identity: () => {
    const account = useAccount.getState().state
    return account.tag === 'signedIn'
      ? { username: account.username, token: account.token }
      : { username: null, token: null }
  },
  preview: previewIntents,
  sessionRejected: () => void accountIntents.sessionRejected(),
})
