import { createPublicKey, verify } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IpcChannel, signedMessage } from '@co-write/shared'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isTrustedSender, registerIpc, UntrustedSenderError } from './ipc'

const APP = 'app://co-write'
const FILE_URL = `${APP}/index.html`

describe('isTrustedSender', () => {
  it('trusts the bundled page in production', () => {
    expect(isTrustedSender(FILE_URL, true, APP)).toBe(true)
    expect(isTrustedSender(`${FILE_URL}#/x`, true, APP)).toBe(true)
  })

  it('rejects files, other origins and subframes', () => {
    expect(isTrustedSender('file:///tmp/evil.html', true, APP)).toBe(false)
    expect(isTrustedSender('app://evil/index.html', true, APP)).toBe(false)
    expect(isTrustedSender('https://evil.example/', true, APP)).toBe(false)
    expect(isTrustedSender(FILE_URL, false, APP)).toBe(false)
    expect(isTrustedSender(undefined, true, APP)).toBe(false)
    expect(isTrustedSender('not a url', true, APP)).toBe(false)
  })

  it('trusts only the dev server origin in development', () => {
    const dev = 'http://localhost:5173'
    expect(isTrustedSender('http://localhost:5173/', true, dev)).toBe(true)
    expect(isTrustedSender('http://localhost:5174/', true, dev)).toBe(false)
    expect(isTrustedSender(FILE_URL, true, dev)).toBe(false)
  })
})

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

let base: string
let root: string
let handlers: Map<string, Handler>
let ipc: ReturnType<typeof registerIpc>
let serverOrigin: string | null
let serverChanged: number
let importPath: string | null
let exportPath: string | null

function fakeEvent(url = FILE_URL, mainFrame = true): IpcMainInvokeEvent {
  const frame = { url }
  const sender = {
    id: 1,
    mainFrame: mainFrame ? frame : { url },
    isDestroyed: () => false,
    send: () => {},
    once: () => {},
  }
  return { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent
}

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(fakeEvent(), ...args)

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'co-write-ipc-')))
  root = join(base, 'project')
  await mkdir(root)
  await writeFile(join(root, 'readme.md'), '# hi')
  await writeFile(join(base, 'outside.md'), 'secret')
  await writeFile(join(root, 'photo.png'), 'not really a png')
  await writeFile(join(root, 'paper.pdf'), '%PDF-1.4 fake')
  await writeFile(join(root, 'data.json'), '{"a":1}')
  await writeFile(join(root, 'letter.rtf'), '{\\rtf1 hi}')
  handlers = new Map()
  serverOrigin = 'https://write.example.com'
  serverChanged = 0
  importPath = null
  exportPath = null
  ipc = registerIpc({
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    windowFor: () => null,
    pickFolder: async () => root,
    appOrigin: APP,
    userDataDir: join(base, 'user-data'),
    server: {
      origin: () => serverOrigin,
      set: async (url: string | null) => {
        serverOrigin = url
      },
    },
    onServerChanged: () => serverChanged++,
    pickKeyToImport: async () => importPath,
    pickKeyExportPath: async () => exportPath,
    openExternal: async () => {},
    fetch: async (url: URL | string) =>
      String(url).startsWith('https://write.example.com')
        ? new Response(
            JSON.stringify({
              auth: 'accounts',
              oauth: [{ id: 'github', label: 'GitHub' }],
              version: '1',
            }),
          )
        : String(url).startsWith('https://not-cowrite.example')
          ? new Response('<html>hi</html>')
          : Promise.reject(new TypeError('fetch failed')),
    cipher: {
      available: true,
      encrypt: (plain: string) => new TextEncoder().encode([...plain].reverse().join('')),
      decrypt: (bytes: Uint8Array) => [...new TextDecoder().decode(bytes)].reverse().join(''),
    },
  } as never)
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('registerIpc', () => {
  it('refuses calls from untrusted frames before doing anything', async () => {
    const handler = handlers.get(IpcChannel.openProject)!
    await expect(handler(fakeEvent('https://evil.example/'))).rejects.toBeInstanceOf(
      UntrustedSenderError,
    )
    await expect(handler(fakeEvent(FILE_URL, false))).rejects.toBeInstanceOf(UntrustedSenderError)
  })

  it('refuses file access before a project is opened', async () => {
    await expect(call(IpcChannel.readFile, 'readme.md')).rejects.toThrow('No project is open')
  })

  it('opens a project and lists the files it can open', async () => {
    const project = await call(IpcChannel.openProject)
    expect(project).toEqual({
      name: 'project',
      tree: [
        { name: 'data.json', path: 'data.json', kind: 'file' },
        { name: 'letter.rtf', path: 'letter.rtf', kind: 'file' },
        { name: 'paper.pdf', path: 'paper.pdf', kind: 'file' },
        { name: 'readme.md', path: 'readme.md', kind: 'file' },
      ],
    })
  })

  it('edits other text formats the same way', async () => {
    await call(IpcChannel.openProject)
    expect(await call(IpcChannel.readFile, 'data.json')).toBe('{"a":1}')
    await call(IpcChannel.saveFile, 'data.json', '{"a":2}')
    expect(await readFile(join(root, 'data.json'), 'utf8')).toBe('{"a":2}')
    await call(IpcChannel.createFile, 'config/app.yaml')
    expect(await readFile(join(root, 'config', 'app.yaml'), 'utf8')).toBe('')
  })

  it('reads PDFs as bytes but never as text or for writing', async () => {
    await call(IpcChannel.openProject)
    const bytes = (await call(IpcChannel.readBinary, 'paper.pdf')) as Uint8Array
    expect(new TextDecoder().decode(bytes)).toBe('%PDF-1.4 fake')
    await expect(call(IpcChannel.readFile, 'paper.pdf')).rejects.toThrow('Not a text file')
    await expect(call(IpcChannel.saveFile, 'paper.pdf', 'x')).rejects.toThrow('text files')
    await expect(call(IpcChannel.createFile, 'new.pdf')).rejects.toThrow('text files')
    await expect(call(IpcChannel.readBinary, 'data.json')).rejects.toThrow('Not a viewable file')
    await expect(call(IpcChannel.readBinary, '../outside.md')).rejects.toThrow()
  })

  it('reads and saves files inside the project', async () => {
    await call(IpcChannel.openProject)
    expect(await call(IpcChannel.readFile, 'readme.md')).toBe('# hi')
    await call(IpcChannel.saveFile, 'readme.md', '# changed')
    expect(await readFile(join(root, 'readme.md'), 'utf8')).toBe('# changed')
  })

  it('rejects malformed payloads', async () => {
    await call(IpcChannel.openProject)
    await expect(call(IpcChannel.readFile, 42)).rejects.toThrow()
    await expect(call(IpcChannel.readFile)).rejects.toThrow()
    await expect(call(IpcChannel.saveFile, 'readme.md', { toString: () => 'x' })).rejects.toThrow()
    await expect(call(IpcChannel.readFile, 'readme.md', 'extra')).rejects.toThrow()
  })

  it('rejects paths that escape the project', async () => {
    await call(IpcChannel.openProject)
    await expect(call(IpcChannel.readFile, '../outside.md')).rejects.toThrow('outside the project')
    await expect(call(IpcChannel.saveFile, '../outside.md', 'pwned')).rejects.toThrow()
    expect(await readFile(join(base, 'outside.md'), 'utf8')).toBe('secret')
  })

  it('only writes the text formats it knows', async () => {
    await call(IpcChannel.openProject)
    await expect(call(IpcChannel.saveFile, 'photo.png', 'x')).rejects.toThrow('text files')
    await expect(call(IpcChannel.createFile, 'photo2.png')).rejects.toThrow('text files')
    expect(await readFile(join(root, 'photo.png'), 'utf8')).toBe('not really a png')
  })

  it('creates new files once', async () => {
    await call(IpcChannel.openProject)
    await call(IpcChannel.createFile, 'notes/new.md')
    expect(await readFile(join(root, 'notes', 'new.md'), 'utf8')).toBe('')
    await expect(call(IpcChannel.createFile, 'notes/new.md')).rejects.toThrow()
  })

  it('file mode: only the launched file is reachable until its folder is opened', async () => {
    await writeFile(join(root, 'other.md'), 'other')
    ipc.openLaunchTarget(fakeEvent().sender, { root, file: 'readme.md' })
    expect(await call(IpcChannel.listProject)).toEqual({
      name: 'project',
      tree: [{ name: 'readme.md', path: 'readme.md', kind: 'file' }],
      file: 'readme.md',
    })
    await expect(call(IpcChannel.readBinary, 'paper.pdf')).rejects.toThrow('Only readme.md')
    expect(await call(IpcChannel.readFile, 'readme.md')).toBe('# hi')
    await expect(call(IpcChannel.readFile, 'other.md')).rejects.toThrow('Only readme.md is open')
    await expect(call(IpcChannel.saveFile, 'other.md', 'x')).rejects.toThrow('Only readme.md')
    await expect(call(IpcChannel.createFile, 'new.md')).rejects.toThrow('Only readme.md')
    const otherState = { kind: 'local', path: 'other.md' }
    await expect(call(IpcChannel.loadDocState, otherState)).rejects.toThrow('Only readme.md')
    expect(await readFile(join(root, 'other.md'), 'utf8')).toBe('other')

    const folder = await call(IpcChannel.openFileFolder)
    expect(folder).toEqual({
      name: 'project',
      tree: [
        { name: 'data.json', path: 'data.json', kind: 'file' },
        { name: 'letter.rtf', path: 'letter.rtf', kind: 'file' },
        { name: 'other.md', path: 'other.md', kind: 'file' },
        { name: 'paper.pdf', path: 'paper.pdf', kind: 'file' },
        { name: 'readme.md', path: 'readme.md', kind: 'file' },
      ],
    })
    expect(await call(IpcChannel.readFile, 'other.md')).toBe('other')
  })

  it('round-trips document state for local and remote documents', async () => {
    await call(IpcChannel.openProject)
    const local = { kind: 'local', path: 'readme.md' }
    const remote = { kind: 'remote', docId: 'doc1' }
    expect(await call(IpcChannel.loadDocState, local)).toBeNull()
    await call(IpcChannel.storeDocState, local, new Uint8Array([1, 2, 3]))
    await call(IpcChannel.storeDocState, remote, new Uint8Array([9]))
    expect(await call(IpcChannel.loadDocState, local)).toEqual(new Uint8Array([1, 2, 3]))
    expect(await call(IpcChannel.loadDocState, remote)).toEqual(new Uint8Array([9]))
    await expect(call(IpcChannel.loadDocState, { kind: 'remote', docId: '../x' })).rejects.toThrow()
  })

  it('stores credentials encrypted, per server, and clears them', async () => {
    const credentials = { username: 'ana', token: 'secret-token' }
    await call(IpcChannel.storeCredentials, credentials)
    const raw = await readFile(join(base, 'user-data', 'credentials.bin'), 'utf8')
    expect(raw).not.toContain('secret-token')
    expect(await call(IpcChannel.loadCredentials)).toEqual(credentials)

    // Another server has its own session, and the first one is still there afterwards.
    serverOrigin = 'https://other.example.org'
    expect(await call(IpcChannel.loadCredentials)).toBeNull()
    await call(IpcChannel.storeCredentials, { username: 'bo', token: 'other-token' })
    serverOrigin = 'https://write.example.com'
    expect(await call(IpcChannel.loadCredentials)).toEqual(credentials)

    await call(IpcChannel.clearCredentials)
    expect(await call(IpcChannel.loadCredentials)).toBeNull()
    serverOrigin = 'https://other.example.org'
    expect(await call(IpcChannel.loadCredentials)).toEqual({ username: 'bo', token: 'other-token' })
  })

  it('has no credentials to load or save without a server', async () => {
    serverOrigin = null
    await call(IpcChannel.storeCredentials, { username: 'ana', token: 't' })
    expect(await call(IpcChannel.loadCredentials)).toBeNull()
  })

  it('chooses the server and tells the windows to reload', async () => {
    expect(await call(IpcChannel.getServer)).toBe('https://write.example.com')
    await call(IpcChannel.setServer, 'http://localhost:8080')
    expect(serverOrigin).toBe('http://localhost:8080')
    expect(serverChanged).toBe(1)
    await call(IpcChannel.setServer, null)
    expect(await call(IpcChannel.getServer)).toBeNull()
    await expect(call(IpcChannel.setServer, '')).rejects.toThrow()
    await expect(call(IpcChannel.setServer, 42)).rejects.toThrow()
  })

  it('probes a server for what it is before it is chosen', async () => {
    expect(await call(IpcChannel.probeServer, 'https://write.example.com/')).toEqual({
      auth: 'accounts',
      oauth: [{ id: 'github', label: 'GitHub' }],
      version: '1',
    })
    await expect(call(IpcChannel.probeServer, 'https://not-cowrite.example')).rejects.toThrow(
      'does not look like',
    )
    await expect(call(IpcChannel.probeServer, 'https://down.example')).rejects.toThrow(
      'Could not reach',
    )
    await expect(call(IpcChannel.probeServer, 'write.example.com')).rejects.toThrow('http')
  })

  describe('keys', () => {
    it('has no key until one is made, then keeps it', async () => {
      expect(await call(IpcChannel.keyInfo)).toBeNull()
      const made = (await call(IpcChannel.generateKey, false)) as {
        publicKey: string
        fingerprint: string
      }
      expect(made.publicKey).toContain('BEGIN PUBLIC KEY')
      expect(made.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
      expect(await call(IpcChannel.keyInfo)).toEqual({ ...made, protected: true })
      await expect(call(IpcChannel.generateKey, false)).rejects.toThrow('already has a key')
      const replaced = (await call(IpcChannel.generateKey, true)) as { fingerprint: string }
      expect(replaced.fingerprint).not.toBe(made.fingerprint)
    })

    it('never stores the private key in the clear when a keychain exists', async () => {
      await call(IpcChannel.generateKey, false)
      const raw = await readFile(join(base, 'user-data', 'identity.key'), 'utf8')
      expect(raw).not.toContain('PRIVATE KEY')
      expect((await stat(join(base, 'user-data', 'identity.key'))).mode & 0o777).toBe(0o600)
    })

    it('signs the texts it builds for the configured server, and only those', async () => {
      const { publicKey } = (await call(IpcChannel.generateKey, false)) as { publicKey: string }
      const check = (message: string, signature: string) =>
        verify(
          null,
          Buffer.from(message),
          createPublicKey(publicKey),
          Buffer.from(signature, 'base64url'),
        )

      const login = (await call(IpcChannel.signWithKey, {
        purpose: 'login',
        nonce: 'n1',
      })) as string
      expect(
        check(signedMessage({ purpose: 'login', origin: serverOrigin!, nonce: 'n1' }), login),
      ).toBe(true)
      expect(
        check(
          signedMessage({ purpose: 'login', origin: 'https://evil.example', nonce: 'n1' }),
          login,
        ),
      ).toBe(false)

      const register = (await call(IpcChannel.signWithKey, {
        purpose: 'register',
        nonce: 'n2',
        username: 'ana',
      })) as string
      expect(
        check(
          signedMessage({
            purpose: 'register',
            origin: serverOrigin!,
            nonce: 'n2',
            username: 'ana',
          }),
          register,
        ),
      ).toBe(true)
    })

    it('refuses to sign arbitrary data, other purposes or without a server', async () => {
      await call(IpcChannel.generateKey, false)
      await expect(
        call(IpcChannel.signWithKey, {
          purpose: 'login',
          nonce: 'n',
          origin: 'https://evil.example',
        }),
      ).rejects.toThrow()
      await expect(
        call(IpcChannel.signWithKey, { purpose: 'transfer', nonce: 'n' }),
      ).rejects.toThrow()
      await expect(call(IpcChannel.signWithKey, 'any text at all')).rejects.toThrow()
      serverOrigin = null
      await expect(call(IpcChannel.signWithKey, { purpose: 'login', nonce: 'n' })).rejects.toThrow(
        'Choose a server',
      )
    })

    it('exports to the chosen file and imports it back on another machine', async () => {
      const made = (await call(IpcChannel.generateKey, false)) as { fingerprint: string }
      exportPath = join(base, 'exported.pem')
      expect(await call(IpcChannel.exportKey)).toBe(true)
      const pem = await readFile(exportPath, 'utf8')
      expect(pem).toContain('BEGIN PRIVATE KEY')
      expect((await stat(exportPath)).mode & 0o777).toBe(0o600)

      exportPath = null
      expect(await call(IpcChannel.exportKey)).toBe(false) // cancelled

      await call(IpcChannel.generateKey, true) // a different key now
      importPath = join(base, 'exported.pem')
      const imported = (await call(IpcChannel.importKey)) as { fingerprint: string }
      expect(imported.fingerprint).toBe(made.fingerprint)

      importPath = null
      expect(await call(IpcChannel.importKey)).toBeNull() // cancelled
    })

    it('rejects files that are not Ed25519 private keys', async () => {
      importPath = join(base, 'junk.pem')
      await writeFile(importPath, 'hello')
      await expect(call(IpcChannel.importKey)).rejects.toThrow('not a PEM private key')
      const { generateKeyPairSync } = await import('node:crypto')
      await writeFile(
        importPath,
        generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
          type: 'pkcs8',
          format: 'pem',
        }),
      )
      await expect(call(IpcChannel.importKey)).rejects.toThrow('Ed25519')
      expect(await call(IpcChannel.keyInfo)).toBeNull()
    })
  })
})
