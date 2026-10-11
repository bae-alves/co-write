import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IpcChannel } from '@co-write/shared'
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
  handlers = new Map()
  registerIpc({
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    windowFor: () => null,
    pickFolder: async () => root,
    appOrigin: APP,
    userDataDir: join(base, 'user-data'),
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

  it('opens a project and lists its Markdown files', async () => {
    const project = await call(IpcChannel.openProject)
    expect(project).toEqual({
      name: 'project',
      tree: [{ name: 'readme.md', path: 'readme.md', kind: 'file' }],
    })
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

  it('only writes Markdown files', async () => {
    await call(IpcChannel.openProject)
    await expect(call(IpcChannel.saveFile, 'run.sh', 'rm -rf /')).rejects.toThrow('Markdown')
    await expect(call(IpcChannel.createFile, 'run.sh')).rejects.toThrow('Markdown')
  })

  it('creates new files once', async () => {
    await call(IpcChannel.openProject)
    await call(IpcChannel.createFile, 'notes/new.md')
    expect(await readFile(join(root, 'notes', 'new.md'), 'utf8')).toBe('')
    await expect(call(IpcChannel.createFile, 'notes/new.md')).rejects.toThrow()
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

  it('stores credentials encrypted and clears them', async () => {
    const credentials = { username: 'ana', token: 'secret-token' }
    await call(IpcChannel.storeCredentials, credentials)
    const raw = await readFile(join(base, 'user-data', 'credentials.bin'), 'utf8')
    expect(raw).not.toContain('secret-token')
    expect(await call(IpcChannel.loadCredentials)).toEqual(credentials)
    await call(IpcChannel.clearCredentials)
    expect(await call(IpcChannel.loadCredentials)).toBeNull()
  })
})
