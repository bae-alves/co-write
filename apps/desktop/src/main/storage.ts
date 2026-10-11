import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CredentialsSchema, type Credentials, type DocRef } from '@co-write/shared'

/**
 * Where a document's Yjs state lives on disk. Local files are keyed by project root + path, so
 * the same relative path in two projects never collides; server documents by their id.
 */
export function docStateFile(dir: string, ref: DocRef, projectRoot: string | null): string {
  const key =
    ref.kind === 'remote'
      ? `remote-${ref.docId}`
      : `local-${createHash('sha256')
          .update(`${projectRoot ?? ''}\0${ref.path}`)
          .digest('hex')}`
  return join(dir, `${key}.ystate`)
}

const notFound = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

export async function loadBytes(file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(file))
  } catch (error) {
    if (notFound(error)) return null
    throw error
  }
}

export async function storeBytes(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  await writeFile(temp, bytes)
  await rename(temp, file)
}

export async function removeFile(file: string): Promise<void> {
  await rm(file, { force: true })
}

/** Encrypts with the OS keychain (Electron `safeStorage`) when available. */
export interface Cipher {
  readonly available: boolean
  encrypt(plain: string): Uint8Array
  decrypt(bytes: Uint8Array): string
}

export async function loadCredentials(file: string, cipher: Cipher): Promise<Credentials | null> {
  if (!cipher.available) return null
  const bytes = await loadBytes(file)
  if (!bytes) return null
  try {
    const parsed = CredentialsSchema.safeParse(JSON.parse(cipher.decrypt(bytes)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function storeCredentials(
  file: string,
  cipher: Cipher,
  credentials: Credentials,
): Promise<void> {
  // Without an OS keychain the token stays in memory only; never write it in plain text.
  if (!cipher.available) return
  await storeBytes(file, cipher.encrypt(JSON.stringify(credentials)))
}
