import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CredentialsSchema, type Credentials, type DocRef } from '@co-write/shared'
import { z } from 'zod'

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

export async function storeBytes(file: string, bytes: Uint8Array, mode?: number): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  await writeFile(temp, bytes, mode === undefined ? undefined : { mode })
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

/** One saved session per server, keyed by the server's origin: switching servers keeps the others. */
const CredentialMapSchema = z.record(z.string(), CredentialsSchema)
type CredentialMap = z.infer<typeof CredentialMapSchema>

async function readCredentialMap(file: string, cipher: Cipher): Promise<CredentialMap> {
  if (!cipher.available) return {}
  const bytes = await loadBytes(file)
  if (!bytes) return {}
  try {
    const parsed = CredentialMapSchema.safeParse(JSON.parse(cipher.decrypt(bytes)))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

async function writeCredentialMap(file: string, cipher: Cipher, map: CredentialMap): Promise<void> {
  if (Object.keys(map).length === 0) return removeFile(file)
  await storeBytes(file, cipher.encrypt(JSON.stringify(map)), 0o600)
}

export async function loadCredentials(
  file: string,
  cipher: Cipher,
  origin: string,
): Promise<Credentials | null> {
  return (await readCredentialMap(file, cipher))[origin] ?? null
}

export async function storeCredentials(
  file: string,
  cipher: Cipher,
  origin: string,
  credentials: Credentials,
): Promise<void> {
  // Without an OS keychain the token stays in memory only; never write it in plain text.
  if (!cipher.available) return
  const map = await readCredentialMap(file, cipher)
  await writeCredentialMap(file, cipher, { ...map, [origin]: credentials })
}

export async function clearCredentials(
  file: string,
  cipher: Cipher,
  origin: string,
): Promise<void> {
  if (!cipher.available) return
  const map = await readCredentialMap(file, cipher)
  delete map[origin]
  await writeCredentialMap(file, cipher, map)
}
