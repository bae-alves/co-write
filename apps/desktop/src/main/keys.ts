import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto'
import { chmod, readFile } from 'node:fs/promises'
import type { KeyInfo } from '@co-write/shared'
import { loadBytes, storeBytes, type Cipher } from './storage'

/**
 * This machine's Ed25519 key. It lives in the main process only: the renderer can ask for the
 * public half and for signatures over texts main builds, never for the private key. The key is
 * encrypted with the OS keychain when there is one; otherwise it is a file only its owner can read.
 *
 * File format: `{"v":1,"encrypted":true,"data":"<base64>"}`; `data` is the PKCS#8 PEM, encrypted
 * or not.
 */
export interface KeyStore {
  info(): Promise<KeyInfo | null>
  /** Creates the key. Replacing an existing one needs `replace`: its accounts would lose access. */
  generate(replace?: boolean): Promise<KeyInfo>
  /** Adopts a PKCS#8 PEM private key (e.g. exported from another machine). */
  importPem(pem: string): Promise<KeyInfo>
  /** The private key as PKCS#8 PEM, for main to write where the user chose. */
  exportPem(): Promise<string>
  /** base64url Ed25519 signature of `message`. */
  sign(message: string): Promise<string>
}

const fingerprintOf = (publicKey: KeyObject): string =>
  `SHA256:${createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64')
    .replace(/=+$/, '')}`

export function createKeyStore({ file, cipher }: { file: string; cipher: Cipher }): KeyStore {
  const persist = async (key: KeyObject): Promise<KeyInfo> => {
    const pem = key.export({ type: 'pkcs8', format: 'pem' }) as string
    const encrypted = cipher.available
    const data = encrypted
      ? Buffer.from(cipher.encrypt(pem)).toString('base64')
      : Buffer.from(pem).toString('base64')
    await storeBytes(
      file,
      new TextEncoder().encode(JSON.stringify({ v: 1, encrypted, data })),
      0o600,
    )
    await chmod(file, 0o600).catch(() => {})
    return describe(key, encrypted)
  }

  const describe = (key: KeyObject, encrypted: boolean): KeyInfo => {
    const publicKey = createPublicKey(key)
    return {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }) as string,
      fingerprint: fingerprintOf(publicKey),
      protected: encrypted,
    }
  }

  const load = async (): Promise<{ key: KeyObject; encrypted: boolean } | null> => {
    const bytes = await loadBytes(file)
    if (!bytes) return null
    try {
      const stored = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
        encrypted?: boolean
        data?: string
      }
      if (typeof stored.data !== 'string') return null
      const raw = Buffer.from(stored.data, 'base64')
      const pem = stored.encrypted ? cipher.decrypt(raw) : raw.toString('utf8')
      return { key: createPrivateKey(pem), encrypted: stored.encrypted === true }
    } catch {
      return null
    }
  }

  const privateKey = async (): Promise<KeyObject> => {
    const loaded = await load()
    if (!loaded) throw new Error('This machine has no key yet.')
    return loaded.key
  }

  return {
    async info() {
      const loaded = await load()
      return loaded ? describe(loaded.key, loaded.encrypted) : null
    },

    async generate(replace = false) {
      if (!replace && (await load())) {
        throw new Error(
          'This machine already has a key. Replacing it locks it out of its accounts.',
        )
      }
      return persist(generateKeyPairSync('ed25519').privateKey)
    },

    async importPem(pem) {
      let key: KeyObject
      try {
        key = createPrivateKey(pem)
      } catch {
        throw new Error('That file is not a PEM private key (PKCS#8, BEGIN PRIVATE KEY).')
      }
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('That is not an Ed25519 key.')
      return persist(key)
    },

    async exportPem() {
      return (await privateKey()).export({ type: 'pkcs8', format: 'pem' }) as string
    },

    async sign(message) {
      return sign(null, Buffer.from(message), await privateKey()).toString('base64url')
    },
  }
}

/** Reads a key file the user picked: small, text, never more. */
export async function readKeyFile(path: string): Promise<string> {
  const MAX_BYTES = 16 * 1024
  const bytes = await readFile(path)
  if (bytes.byteLength > MAX_BYTES) throw new Error('That file is too large to be a key.')
  return bytes.toString('utf8')
}
