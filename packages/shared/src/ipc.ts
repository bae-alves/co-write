import { z } from 'zod'
import type { InstanceInfo } from './api'

export { IpcChannel } from './channels'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
/** PDFs are shown, never edited, so they may be larger than an editable text file. */
export const MAX_BINARY_BYTES = 100 * 1024 * 1024
export const MAX_DOC_STATE_BYTES = 64 * 1024 * 1024

/** A path relative to the project root, `/`-separated. Main still resolves and confines it. */
export const RelativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.includes('\0'), 'NUL in path')

export const FileContentSchema = z.string().max(MAX_FILE_BYTES)

export const ServerDocIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

/** Which document a persisted Yjs state belongs to. */
export const DocRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), path: RelativePathSchema }).strict(),
  z.object({ kind: z.literal('remote'), docId: ServerDocIdSchema }).strict(),
])
export type DocRef = z.infer<typeof DocRefSchema>

export const DocStateSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength <= MAX_DOC_STATE_BYTES, 'Document state too large')

export const CredentialsSchema = z
  .object({
    username: z.string().min(1).max(64),
    token: z.string().min(1).max(512),
  })
  .strict()
export type Credentials = z.infer<typeof CredentialsSchema>

/** The server address the app talks to; main reduces it to its origin before storing it. */
export const ServerUrlSchema = z.string().min(1).max(512)

/** What `GET /api/instance` answers. Checked in main before a server is chosen. */
export const InstanceInfoSchema = z.object({
  auth: z.enum(['none', 'accounts']),
  oauth: z.array(z.object({ id: z.string(), label: z.string() })),
  version: z.string(),
})

/**
 * What the renderer may ask main to sign. Main adds the origin of the configured server and builds
 * the text itself (`signedMessage`), so the renderer can neither read the key nor get a signature
 * over anything else.
 */
export const SigningInputSchema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('login'), nonce: z.string().min(1).max(256) }).strict(),
  z
    .object({
      purpose: z.literal('register'),
      nonce: z.string().min(1).max(256),
      username: z.string().min(1).max(64),
    })
    .strict(),
])
export type SigningInput = z.infer<typeof SigningInputSchema>

export const OAuthRequestSchema = z
  .object({
    provider: z.string().regex(/^[a-z0-9-]{1,32}$/),
    /** One-time link intent from `POST /api/me/oauth/link-intent`, to link instead of sign in. */
    linkIntent: z.string().min(1).max(256).optional(),
  })
  .strict()
export type OAuthRequest = z.infer<typeof OAuthRequestSchema>

export const MenuCommandSchema = z.enum([
  'open-folder',
  'new-file',
  'save',
  'undo',
  'redo',
  'toggle-files',
  'toggle-source',
  'toggle-preview',
  'close-tab',
  'next-tab',
  'previous-tab',
])
export type MenuCommand = z.infer<typeof MenuCommandSchema>

/** This machine's Ed25519 key. The private half never leaves the main process. */
export interface KeyInfo {
  /** SPKI PEM, to register with a server or paste into another device's account. */
  readonly publicKey: string
  readonly fingerprint: string
  /** Stored encrypted by the OS keychain; false when none is available and it is only file-protected. */
  readonly protected: boolean
}

export interface FileNode {
  readonly name: string
  /** Relative to the project root, `/`-separated. */
  readonly path: string
  readonly kind: 'file' | 'dir'
  readonly children?: readonly FileNode[]
}

export interface ProjectInfo {
  readonly name: string
  readonly tree: readonly FileNode[]
  /**
   * File mode (`co-write notes.md`): only this file is open, not the folder around it, and it is
   * the only file the window may touch. Absent in folder mode.
   */
  readonly file?: string
}

export type ProjectChange =
  | { readonly kind: 'tree'; readonly tree: readonly FileNode[] }
  | { readonly kind: 'file'; readonly path: string }

/** What preload exposes as `window.api`. */
export interface CoWriteApi {
  /** Shows a folder picker; the chosen folder becomes the only place file calls may touch. */
  openProject(): Promise<ProjectInfo | null>
  listProject(): Promise<ProjectInfo | null>
  /** File mode → folder mode: opens the folder that holds the file. */
  openFileFolder(): Promise<ProjectInfo | null>
  readFile(path: string): Promise<string>
  /** Bytes of a file that is shown but not edited (PDF). */
  readBinary(path: string): Promise<Uint8Array>
  saveFile(path: string, content: string): Promise<void>
  /** Creates an empty file; fails if it already exists. */
  createFile(path: string): Promise<void>
  loadDocState(ref: DocRef): Promise<Uint8Array | null>
  storeDocState(ref: DocRef, state: Uint8Array): Promise<void>
  loadCredentials(): Promise<Credentials | null>
  storeCredentials(credentials: Credentials): Promise<void>
  clearCredentials(): Promise<void>
  /** The server this window talks to (an origin), or null when none is chosen yet. */
  getServer(): Promise<string | null>
  /** Chooses the server (null forgets it). Every window reloads so it connects to the new one. */
  setServer(url: string | null): Promise<void>
  /**
   * Asks a server what it is (`GET /api/instance`) before it is chosen. Main does the request: the
   * renderer's CSP only lets it reach the server that is already chosen.
   */
  probeServer(url: string): Promise<InstanceInfo>
  keyInfo(): Promise<KeyInfo | null>
  /** Creates this machine's key; refuses to replace an existing one unless `replace` is set. */
  generateKey(replace?: boolean): Promise<KeyInfo>
  /** Asks for a PKCS#8 PEM private key file and adopts it; null when cancelled. */
  importKey(): Promise<KeyInfo | null>
  /** Saves the private key where the user chooses; false when cancelled. */
  exportKey(): Promise<boolean>
  /** Signs a login or registration challenge for the configured server; returns base64url. */
  signWithKey(input: SigningInput): Promise<string>
  /** Opens the system browser for an OAuth sign-in (or link) and returns the session. */
  oauthSignIn(request: OAuthRequest): Promise<Credentials>
  /** Returns an unsubscribe function. */
  onProjectChanged(listener: (change: ProjectChange) => void): () => void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}
