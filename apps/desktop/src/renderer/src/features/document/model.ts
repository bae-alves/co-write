import {
  capabilitiesOf,
  type Capabilities,
  type DocRef,
  type FileKind,
  type Role,
} from '@co-write/shared'
import { createDfaModel } from '@/kit/dfa'

export interface PeerInfo {
  readonly clientId: number
  readonly name: string
  readonly color: string
}

interface Opened {
  /** Changes whenever a different document (or a fresh copy of the same one) is opened. */
  readonly session: number
  readonly title: string
  /** Decides which columns the document gets and what the preview shows. */
  readonly fileKind: FileKind
}

export interface LocalDocument extends Opened {
  readonly ref: Extract<DocRef, { kind: 'local' }>
  readonly dirty: boolean
  readonly saving: boolean
  /** The file changed on disk while there were unsaved edits. */
  readonly diskChanged: boolean
  readonly saveError: string | null
}

/** A file that is shown but not edited (PDF): no Y.Doc, no source column. */
export interface ViewedDocument extends Opened {
  readonly ref: Extract<DocRef, { kind: 'local' }>
}

export interface RemoteDocument extends Opened {
  readonly ref: Extract<DocRef, { kind: 'remote' }>
  readonly role: Role
  readonly peers: readonly PeerInfo[]
}

export type DocumentState =
  | { readonly tag: 'empty' }
  | {
      readonly tag: 'loading'
      readonly ref: DocRef
      readonly title: string
      readonly fileKind: FileKind
    }
  | ({ readonly tag: 'local' } & LocalDocument)
  | ({ readonly tag: 'viewing' } & ViewedDocument)
  | ({ readonly tag: 'connecting' } & RemoteDocument)
  | ({ readonly tag: 'synced' } & RemoteDocument)
  | ({ readonly tag: 'offline' } & RemoteDocument)
  | {
      readonly tag: 'closed'
      readonly ref: DocRef
      readonly title: string
      readonly fileKind: FileKind
      readonly reason: string
    }
  | {
      readonly tag: 'failed'
      readonly ref: DocRef
      readonly title: string
      readonly fileKind: FileKind
      readonly reason: string
    }

export type RemoteOpen = Extract<DocumentState, { tag: 'connecting' | 'synced' | 'offline' }>
export type OpenDocument = Extract<DocumentState, { tag: 'local' }> | RemoteOpen

export const isRemoteOpen = (state: DocumentState): state is RemoteOpen =>
  state.tag === 'connecting' || state.tag === 'synced' || state.tag === 'offline'

export const isOpen = (state: DocumentState): state is OpenDocument =>
  state.tag === 'local' || isRemoteOpen(state)

/** The columns the open file uses; null while nothing is open (the user's layout applies as is). */
export const capabilitiesOfState = (state: DocumentState): Capabilities | null =>
  'fileKind' in state ? capabilitiesOf(state.fileKind) : null

const leave = ['loading', 'empty'] as const

/**
 *   empty ─► loading ─► local ⟲                          (an editable file)
 *               │   ├─► viewing                          (a PDF: shown, never edited)
 *               │   └─► connecting ─► synced ◄─► offline   (each ⟲ on peer / status updates)
 *               │            └──────────┴──────────┴─► closed  (server refused: auth, access, gone)
 *               └─► failed
 *   Every state can start loading another document or go back to empty. Switching to a tab that is
 *   already open also passes through `loading` and then lands on that tab's own state, which is
 *   why `loading` may go to any of them.
 */
export const useDocument = createDfaModel<DocumentState>(
  { tag: 'empty' },
  {
    empty: ['loading'],
    loading: [
      'loading',
      'local',
      'viewing',
      'connecting',
      'synced',
      'offline',
      'closed',
      'failed',
      'empty',
    ],
    local: ['local', ...leave],
    viewing: ['viewing', ...leave],
    connecting: ['connecting', 'synced', 'offline', 'closed', ...leave],
    synced: ['synced', 'offline', 'closed', ...leave],
    offline: ['offline', 'synced', 'closed', ...leave],
    closed: [...leave],
    failed: [...leave],
  },
)

/** One open document in the tab bar. */
export interface Tab {
  /** Stable for the document: `local:<path>` or `remote:<id>`. */
  readonly key: string
  readonly ref: DocRef
  readonly title: string
  readonly fileKind: FileKind
  /** Changes when the editing session is replaced; null while opening, failed or viewing. */
  readonly session: number | null
  readonly dirty: boolean
  readonly readOnly: boolean
}

/** The tab bar: the open documents in order, and which one is showing. */
export type Tabs =
  | { readonly tag: 'none' }
  | { readonly tag: 'open'; readonly tabs: readonly Tab[]; readonly active: string }

/**
 *   none ◄──► open ⟲   (tabs opened, closed, reordered, dirtied)
 */
export const useTabs = createDfaModel<Tabs>(
  { tag: 'none' },
  { none: ['open', 'none'], open: ['open', 'none'] },
)
