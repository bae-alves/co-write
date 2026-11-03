import {
  CollabCloseCode,
  DEFAULT_KIND,
  fileKindOf,
  type DocRef,
  type FileKind,
  type Role,
} from '@co-write/shared'
import { accountIntents } from '@/features/account/intent'
import { useAccount } from '@/features/account/model'
import { previewIntents, type PreviewSource } from '@/features/preview/intent'
import {
  isRemoteOpen,
  useDocument,
  useTabs,
  type DocumentState,
  type RemoteDocument,
  type RemoteOpen,
  type Tab,
} from './model'
import {
  documentRepository,
  type Binding,
  type DocumentRepository,
  type LocalSession,
  type RemoteSession,
  type UserInfo,
  type ViewSession,
} from './repository'

export interface DocumentDeps {
  readonly model: typeof useDocument
  readonly tabs: typeof useTabs
  readonly repository: DocumentRepository
  /** Who is editing: the signed-in user, if any, and their token. */
  readonly identity: () => {
    readonly username: string | null
    readonly token: string | null
    /** An instance without accounts: no token is needed, and none exists. */
    readonly open: boolean
  }
  readonly preview: {
    show(source: PreviewSource): void
    textChanged(text: string): void
    clear(): void
  }
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

/** A shared document is text; its title's extension (`data.json`) picks the editor and preview. */
export function remoteKind(title: string): FileKind {
  const kind = fileKindOf(title)
  return kind && !kind.binary ? kind : DEFAULT_KIND
}

const keyOf = (ref: DocRef): string =>
  ref.kind === 'local' ? `local:${ref.path}` : `remote:${ref.docId}`

const CLOSE_REASONS: Record<number, string> = {
  [CollabCloseCode.unauthenticated]: 'Your session expired. Sign in again to keep editing.',
  [CollabCloseCode.forbidden]: 'You no longer have access to this document.',
  [CollabCloseCode.notFound]: 'This document no longer exists on the server.',
}

type Session = LocalSession | RemoteSession | ViewSession

/** One open tab: its session stays alive in the background, so undo, drafts and sync survive. */
interface Entry {
  readonly key: string
  readonly ref: DocRef
  readonly title: string
  readonly fileKind: FileKind
  session: Session | null
  /** What the document model shows while this tab is active. */
  state: DocumentState
  unsubscribe: (() => void)[]
}

export function createDocumentIntents(deps: DocumentDeps) {
  const { model, repository, preview } = deps
  const go = (next: DocumentState) => model.getState().go(next)

  const entries = new Map<string, Entry>()
  /** Tab order, left to right. */
  let order: string[] = []
  let activeKey: string | null = null
  let sessionCounter = 0

  const user = (): UserInfo => {
    const name = deps.identity().username ?? 'You'
    return { name, color: colorFor(name) }
  }

  const activeEntry = (): Entry | null => (activeKey ? (entries.get(activeKey) ?? null) : null)

  // ---- What the views see ---------------------------------------------------------------

  const tabOf = (entry: Entry): Tab => {
    const state = entry.state
    const editing =
      state.tag === 'local' ||
      state.tag === 'connecting' ||
      state.tag === 'synced' ||
      state.tag === 'offline'
    return {
      key: entry.key,
      ref: entry.ref,
      title: entry.title,
      fileKind: entry.fileKind,
      session: editing ? state.session : null,
      dirty: state.tag === 'local' && state.dirty,
      readOnly: isRemoteOpen(state) && state.role === 'viewer',
    }
  }

  function publishTabs(): void {
    const tabs = order.flatMap((key) => {
      const entry = entries.get(key)
      return entry ? [tabOf(entry)] : []
    })
    if (tabs.length === 0 || activeKey === null) deps.tabs.getState().go({ tag: 'none' })
    else deps.tabs.getState().go({ tag: 'open', tabs, active: activeKey })
  }

  /** The preview column follows the active tab. */
  function showPreview(entry: Entry): void {
    const session = entry.session
    const kind = entry.fileKind.preview
    if (session?.kind === 'view') preview.show({ kind: 'pdf', data: session.bytes() })
    else if (session && (kind === 'markdown' || kind === 'rtf')) {
      preview.show({ kind, text: session.text() })
    } else preview.clear()
  }

  /** Makes the model describe `entry`: via `loading`, the one state every state may leave to. */
  function present(entry: Entry): void {
    go({ tag: 'loading', ref: entry.ref, title: entry.title, fileKind: entry.fileKind })
    go(entry.state)
    showPreview(entry)
  }

  function setState(entry: Entry, next: DocumentState): void {
    entry.state = next
    if (entry.key === activeKey) go(next)
    publishTabs()
  }

  function textChanged(entry: Entry, text: string): void {
    const kind = entry.fileKind.preview
    if (entry.key === activeKey && (kind === 'markdown' || kind === 'rtf')) {
      preview.textChanged(text)
    }
  }

  const updateRemote = (entry: Entry, update: (doc: RemoteOpen) => DocumentState | null) => {
    if (!isRemoteOpen(entry.state)) return
    const next = update(entry.state)
    if (next) setState(entry, next)
  }

  // ---- Opening and closing tabs ---------------------------------------------------------

  async function release(entry: Entry): Promise<void> {
    entry.unsubscribe.forEach((stop) => stop())
    entry.unsubscribe = []
    const session = entry.session
    entry.session = null
    await session?.close()
  }

  /** Shows an already open tab. */
  function activate(key: string): void {
    const entry = entries.get(key)
    if (!entry || key === activeKey) return
    activeKey = key
    present(entry)
    publishTabs()
  }

  /**
   * Starts opening `ref` in a new tab, or switches to its tab if it is already open. Returns null
   * when there is nothing left to do. A tab whose open failed is replaced, so clicking it retries.
   */
  function start(ref: DocRef, title: string, fileKind: FileKind): Entry | null {
    const key = keyOf(ref)
    const existing = entries.get(key)
    if (existing && existing.state.tag !== 'failed') {
      activate(key)
      return null
    }
    if (existing) {
      order = order.filter((k) => k !== key)
      void release(existing)
    }
    const entry: Entry = {
      key,
      ref,
      title,
      fileKind,
      session: null,
      state: { tag: 'loading', ref, title, fileKind },
      unsubscribe: [],
    }
    entries.set(key, entry)
    order.push(key)
    activeKey = key
    present(entry)
    publishTabs()
    return entry
  }

  /** Runs `open` for a tab that is loading; false when it failed or the tab was closed meanwhile. */
  async function opened<S extends Session>(
    entry: Entry,
    open: () => Promise<S>,
  ): Promise<S | null> {
    let session: S
    try {
      session = await open()
    } catch (error) {
      if (entries.get(entry.key) === entry) {
        setState(entry, {
          tag: 'failed',
          ref: entry.ref,
          title: entry.title,
          fileKind: entry.fileKind,
          reason: message(error),
        })
      }
      return null
    }
    if (entries.get(entry.key) !== entry) {
      await session.close()
      return null
    }
    entry.session = session
    return session
  }

  const intents = {
    async openLocal(path: string): Promise<void> {
      const ref = { kind: 'local' as const, path }
      const fileKind = fileKindOf(path) ?? DEFAULT_KIND
      const title = basename(path)
      const entry = start(ref, title, fileKind)
      if (!entry) return

      if (fileKind.binary) {
        const view = await opened(entry, () => repository.openView(path))
        if (!view) return
        setState(entry, { tag: 'viewing', session: ++sessionCounter, ref, title, fileKind })
        if (entry.key === activeKey) showPreview(entry)
        return
      }

      const session = await opened(entry, () => repository.openLocal(path, user()))
      if (!session) return
      const isDirty = () => session.text() !== session.baseText()
      setState(entry, {
        tag: 'local',
        session: ++sessionCounter,
        ref,
        title,
        fileKind,
        dirty: isDirty(),
        saving: false,
        diskChanged: false,
        saveError: null,
      })
      if (entry.key === activeKey) showPreview(entry)
      entry.unsubscribe.push(
        session.onTextChange((text) => {
          textChanged(entry, text)
          const now = entry.state
          if (now.tag === 'local' && now.dirty !== isDirty()) {
            setState(entry, { ...now, dirty: isDirty() })
          }
        }),
      )
    },

    /**
     * Opens a server document. With `seed`, an empty document is filled with that text once
     * the first sync has shown it really is empty (used to publish a local file).
     */
    async openRemote(docId: string, title: string, role: Role, seed?: string): Promise<void> {
      const ref = { kind: 'remote' as const, docId }
      const fileKind = remoteKind(title)
      const entry = start(ref, title, fileKind)
      if (!entry) return
      const { token, open } = deps.identity()
      const session = await opened(entry, async () => {
        if (!token && !open) throw new Error('Sign in to open shared documents.')
        return repository.openRemote(docId, token, user())
      })
      if (!session) return

      const doc: RemoteDocument = {
        session: ++sessionCounter,
        ref,
        title,
        fileKind,
        role,
        peers: [],
      }
      setState(entry, { tag: 'connecting', ...doc })
      if (entry.key === activeKey) showPreview(entry)
      let seedPending = seed !== undefined && role !== 'viewer'

      entry.unsubscribe.push(
        session.onTextChange((text) => textChanged(entry, text)),
        session.onSynced(() => {
          if (seedPending) {
            seedPending = false
            if (session.text() === '') session.replaceText(seed!)
          }
          updateRemote(entry, (now) => (now.tag === 'synced' ? null : { ...now, tag: 'synced' }))
        }),
        session.onStatus((status) => {
          if (status === 'disconnected') {
            updateRemote(entry, (now) =>
              now.tag === 'offline' ? null : { ...now, tag: 'offline' },
            )
          }
        }),
        session.onPeers((peers) => updateRemote(entry, (now) => ({ ...now, peers }))),
        session.onClosed((code, reason) => {
          if (code === CollabCloseCode.unauthenticated) deps.sessionRejected()
          updateRemote(entry, (now) => ({
            tag: 'closed',
            ref: now.ref,
            title: now.title,
            fileKind: now.fileKind,
            reason: CLOSE_REASONS[code] ?? (reason || 'The server closed this document.'),
          }))
        }),
      )
    },

    activate,

    /** Switches to the tab `step` places away, wrapping around. */
    cycle(step: number): void {
      if (order.length < 2 || activeKey === null) return
      const next = (order.indexOf(activeKey) + step + order.length) % order.length
      activate(order[next]!)
    },

    /** Closes one tab (default: the active one). Unsaved drafts stay on this machine. */
    async closeTab(key: string | null = activeKey): Promise<void> {
      const entry = key ? entries.get(key) : undefined
      if (!entry) return
      const index = order.indexOf(entry.key)
      entries.delete(entry.key)
      order = order.filter((k) => k !== entry.key)
      if (entry.key === activeKey) {
        const neighbour = order[index] ?? order[index - 1] ?? null
        const next = neighbour ? entries.get(neighbour) : undefined
        activeKey = neighbour
        if (next) present(next)
        else {
          preview.clear()
          if (model.getState().state.tag !== 'empty') go({ tag: 'empty' })
        }
      }
      publishTabs()
      await release(entry)
    },

    /** Closes every tab (another folder was opened). */
    async close(): Promise<void> {
      await closeWhere(() => true)
    },

    /** Closes the shared documents only (signing out), leaving local files open. */
    async closeRemote(): Promise<void> {
      await closeWhere((entry) => entry.ref.kind === 'remote')
    },

    async save(): Promise<void> {
      const entry = activeEntry()
      const session = entry?.session
      if (!entry || session?.kind !== 'local') return
      const now = entry.state
      if (now.tag !== 'local' || now.saving) return
      setState(entry, { ...now, saving: true, saveError: null })
      try {
        await session.save()
        const after = entry.state
        if (after.tag === 'local' && after.session === now.session) {
          setState(entry, {
            ...after,
            saving: false,
            diskChanged: false,
            dirty: session.text() !== session.baseText(),
          })
        }
      } catch (error) {
        const after = entry.state
        if (after.tag === 'local' && after.session === now.session) {
          setState(entry, { ...after, saving: false, saveError: message(error) })
        }
      }
    },

    /** A file in the project changed on disk (possibly by our own save). */
    async fileChangedOnDisk(path: string): Promise<void> {
      const entry = entries.get(keyOf({ kind: 'local', path }))
      const session = entry?.session
      if (!entry || !session) return

      if (session.kind === 'view') {
        const bytes = await session.reload().catch(() => null)
        if (bytes && entries.get(entry.key) === entry && entry.key === activeKey) showPreview(entry)
        return
      }
      if (session.kind !== 'local' || entry.state.tag !== 'local') return
      const disk = await session.readDisk().catch(() => null)
      if (disk === null || disk === session.baseText() || entry.session !== session) return
      const after = entry.state
      if (after.tag !== 'local') return
      if (!after.dirty) {
        session.reload(disk)
        setState(entry, { ...after, dirty: false, diskChanged: false })
      } else {
        setState(entry, { ...after, diskChanged: true })
      }
    },

    /** What the editor of tab `key` (default: the active one) binds to, if it has an editor. */
    binding(key: string | null = activeKey): Binding | null {
      const session = key ? entries.get(key)?.session : null
      return session && session.kind !== 'view' ? session.binding : null
    },

    /** The text of the active document (e.g. to publish it). */
    text(): string | null {
      const session = activeEntry()?.session
      return session && session.kind !== 'view' ? session.text() : null
    },
  }

  async function closeWhere(matches: (entry: Entry) => boolean): Promise<void> {
    const closing = [...entries.values()].filter(matches)
    if (closing.length === 0) return
    for (const entry of closing) entries.delete(entry.key)
    order = order.filter((key) => entries.has(key))
    const wasActive = activeKey !== null && !entries.has(activeKey)
    if (wasActive) {
      activeKey = order[order.length - 1] ?? null
      const next = activeKey ? entries.get(activeKey) : undefined
      if (next) present(next)
      else {
        preview.clear()
        if (model.getState().state.tag !== 'empty') go({ tag: 'empty' })
      }
    }
    publishTabs()
    await Promise.all(closing.map(release))
  }

  return intents
}

export type DocumentIntents = ReturnType<typeof createDocumentIntents>

export const documentIntents = createDocumentIntents({
  model: useDocument,
  tabs: useTabs,
  repository: documentRepository,
  identity: () => {
    const account = useAccount.getState().state
    if (account.tag === 'anonymous') return { username: account.name, token: null, open: true }
    return account.tag === 'signedIn'
      ? { username: account.username, token: account.token, open: false }
      : { username: null, token: null, open: false }
  },
  preview: previewIntents,
  sessionRejected: () => void accountIntents.sessionRejected(),
})
