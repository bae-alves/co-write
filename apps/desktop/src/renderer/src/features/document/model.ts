import type { DocRef, Role } from '@co-write/shared'
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
}

export interface LocalDocument extends Opened {
  readonly ref: Extract<DocRef, { kind: 'local' }>
  readonly dirty: boolean
  readonly saving: boolean
  /** The file changed on disk while there were unsaved edits. */
  readonly diskChanged: boolean
  readonly saveError: string | null
}

export interface RemoteDocument extends Opened {
  readonly ref: Extract<DocRef, { kind: 'remote' }>
  readonly role: Role
  readonly peers: readonly PeerInfo[]
}

export type DocumentState =
  | { readonly tag: 'empty' }
  | { readonly tag: 'loading'; readonly ref: DocRef; readonly title: string }
  | ({ readonly tag: 'local' } & LocalDocument)
  | ({ readonly tag: 'connecting' } & RemoteDocument)
  | ({ readonly tag: 'synced' } & RemoteDocument)
  | ({ readonly tag: 'offline' } & RemoteDocument)
  | {
      readonly tag: 'closed'
      readonly ref: DocRef
      readonly title: string
      readonly reason: string
    }
  | {
      readonly tag: 'failed'
      readonly ref: DocRef
      readonly title: string
      readonly reason: string
    }

export type RemoteOpen = Extract<DocumentState, { tag: 'connecting' | 'synced' | 'offline' }>
export type OpenDocument = Extract<DocumentState, { tag: 'local' }> | RemoteOpen

export const isRemoteOpen = (state: DocumentState): state is RemoteOpen =>
  state.tag === 'connecting' || state.tag === 'synced' || state.tag === 'offline'

export const isOpen = (state: DocumentState): state is OpenDocument =>
  state.tag === 'local' || isRemoteOpen(state)

const leave = ['loading', 'empty'] as const

/**
 *   empty ─► loading ─► local ⟲
 *               │
 *               ├─► connecting ─► synced ◄─► offline      (each ⟲ on peer / status updates)
 *               │        └──────────┴──────────┴─► closed  (server refused: auth, access, gone)
 *               └─► failed
 *   Every state can start loading another document or go back to empty.
 */
export const useDocument = createDfaModel<DocumentState>(
  { tag: 'empty' },
  {
    empty: ['loading'],
    loading: ['loading', 'local', 'connecting', 'failed', 'empty'],
    local: ['local', ...leave],
    connecting: ['connecting', 'synced', 'offline', 'closed', ...leave],
    synced: ['synced', 'offline', 'closed', ...leave],
    offline: ['offline', 'synced', 'closed', ...leave],
    closed: [...leave],
    failed: [...leave],
  },
)
