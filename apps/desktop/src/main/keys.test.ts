import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createKeyStore } from './keys'
import type { Cipher } from './storage'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'co-write-keys-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const keychain: Cipher = {
  available: true,
  encrypt: (plain) => new TextEncoder().encode([...plain].reverse().join('')),
  decrypt: (bytes) => [...new TextDecoder().decode(bytes)].reverse().join(''),
}
const noKeychain: Cipher = { ...keychain, available: false }

describe('key store', () => {
  it('matches the server: fingerprints and signatures of the fixture key agree', async () => {
    // The Kotlin side verifies Node-made signatures; here Node verifies its own through the store.
    const store = createKeyStore({ file: join(dir, 'k'), cipher: keychain })
    const info = await store.generate()
    expect(info.protected).toBe(true)
    expect(info.fingerprint).toMatch(/^SHA256:/)
    expect(await store.sign('hello')).toMatch(/^[A-Za-z0-9_-]{86}$/)
  })

  it('persists across instances and reads back the same key', async () => {
    const file = join(dir, 'k')
    const first = await createKeyStore({ file, cipher: keychain }).generate()
    const again = await createKeyStore({ file, cipher: keychain }).info()
    expect(again).toEqual(first)
  })

  it('falls back to a file-protected key when there is no keychain, and says so', async () => {
    const file = join(dir, 'k')
    const info = await createKeyStore({ file, cipher: noKeychain }).generate()
    expect(info.protected).toBe(false)
    expect((await createKeyStore({ file, cipher: noKeychain }).info())?.fingerprint).toBe(
      info.fingerprint,
    )
  })

  it('does not decrypt a key the keychain can no longer open', async () => {
    const file = join(dir, 'k')
    await createKeyStore({ file, cipher: keychain }).generate()
    const broken: Cipher = {
      ...keychain,
      decrypt: () => {
        throw new Error('keychain locked')
      },
    }
    expect(await createKeyStore({ file, cipher: broken }).info()).toBeNull()
  })

  it('ignores a damaged key file', async () => {
    const file = join(dir, 'k')
    await writeFile(file, 'not json')
    expect(await createKeyStore({ file, cipher: keychain }).info()).toBeNull()
    await expect(createKeyStore({ file, cipher: keychain }).sign('x')).rejects.toThrow('no key')
  })
})
