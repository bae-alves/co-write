/**
 * The desktop ⇄ Ktor contract: REST bodies and WebSocket close codes.
 * Mirrors the `@Serializable` types in `apps/server` — keep them in sync.
 */

export type Role = 'owner' | 'editor' | 'viewer'

/** `GET /api/instance`: what a client needs to know before it signs in. */
export interface InstanceInfo {
  /** `none`: no accounts, every document open to everyone. `accounts`: keys, optional OAuth, roles. */
  readonly auth: 'none' | 'accounts'
  readonly oauth: readonly OAuthProvider[]
  readonly version: string
}

export interface OAuthProvider {
  readonly id: string
  readonly label: string
}

export interface ChallengeResponse {
  readonly nonce: string
  readonly expiresAt: number
}

/** The signature is over a text main builds (`signedMessage`): purpose, server origin, nonce, username. */
export interface RegisterRequest {
  readonly username: string
  /** SPKI PEM of the Ed25519 public key. */
  readonly publicKey: string
  readonly nonce: string
  readonly signature: string
}

export interface LoginRequest {
  readonly username: string
  readonly nonce: string
  readonly signature: string
}

export interface AuthResponse {
  readonly username: string
  readonly token: string
}

export interface KeySummary {
  readonly id: number
  readonly fingerprint: string
  readonly label: string
  readonly createdAt: number
}

export interface AddKeyRequest {
  readonly publicKey: string
  readonly label: string
}

export interface LinkedIdentity {
  readonly provider: string
  readonly login: string
}

export interface TicketResponse {
  readonly ticket: string
  readonly expiresAt: number
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

export interface OwnerRequest {
  readonly username: string
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
  /** Not terminal: the client reconnects, with a fresh ticket, and gets its new role. */
  roleChanged: 4001,
} as const

/** Document rooms live at `${COLLAB_PATH}/{docId}?ticket=…` (no ticket on an `auth: none` instance). */
export const COLLAB_PATH = '/ws/docs'
