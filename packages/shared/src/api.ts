/**
 * The desktop ⇄ Ktor contract: REST bodies and WebSocket close codes.
 * Mirrors the `@Serializable` types in `apps/server` — keep them in sync.
 */

export type Role = 'owner' | 'editor' | 'viewer'

export interface AuthRequest {
  readonly username: string
  readonly password: string
}

export interface AuthResponse {
  readonly username: string
  readonly token: string
}

export interface DocumentSummary {
  readonly id: string
  readonly title: string
  readonly owner: string
  readonly role: Role
  /** Epoch milliseconds. */
  readonly updatedAt: number
}

export interface CreateDocumentRequest {
  readonly title: string
}

export interface MemberRequest {
  readonly username: string
  readonly role: Exclude<Role, 'owner'>
}

export interface ErrorResponse {
  readonly error: string
}

/** Close codes the collaboration socket uses for reasons a reconnect cannot fix. */
export const CollabCloseCode = {
  unauthenticated: 4401,
  forbidden: 4403,
  notFound: 4404,
} as const

/** Document rooms live at `${COLLAB_PATH}/{docId}?token=…`. */
export const COLLAB_PATH = '/ws/docs'
