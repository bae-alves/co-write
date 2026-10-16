import { z } from 'zod'

export { IpcChannel } from './channels'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
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

export const MenuCommandSchema = z.enum([
  'open-folder',
  'new-file',
  'save',
  'undo',
  'redo',
  'toggle-files',
  'toggle-source',
  'toggle-preview',
])
export type MenuCommand = z.infer<typeof MenuCommandSchema>

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
  saveFile(path: string, content: string): Promise<void>
  /** Creates an empty file; fails if it already exists. */
  createFile(path: string): Promise<void>
  loadDocState(ref: DocRef): Promise<Uint8Array | null>
  storeDocState(ref: DocRef, state: Uint8Array): Promise<void>
  loadCredentials(): Promise<Credentials | null>
  storeCredentials(credentials: Credentials): Promise<void>
  clearCredentials(): Promise<void>
  /** Returns an unsubscribe function. */
  onProjectChanged(listener: (change: ProjectChange) => void): () => void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}
