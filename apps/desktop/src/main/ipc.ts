import { join } from 'node:path'
import {
  CredentialsSchema,
  DocRefSchema,
  DocStateSchema,
  FileContentSchema,
  IpcChannel,
  RelativePathSchema,
  type DocRef,
  type ProjectChange,
  type ProjectInfo,
} from '@co-write/shared'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { z } from 'zod'
import {
  createProjectFile,
  listTree,
  readProjectFile,
  saveProjectFile,
  watchProject,
} from './project'
import {
  docStateFile,
  loadBytes,
  loadCredentials,
  removeFile,
  storeBytes,
  storeCredentials,
  type Cipher,
} from './storage'

export class UntrustedSenderError extends Error {
  constructor(url: string) {
    super(`IPC from an untrusted frame: ${url}`)
    this.name = 'UntrustedSenderError'
  }
}

/**
 * Only the app's own top-level page may call privileged APIs: the dev server in development,
 * `app://co-write` in production. Subframes are always refused.
 */
export function isTrustedSender(
  frameUrl: string | undefined,
  isMainFrame: boolean,
  appOrigin: string,
): boolean {
  if (!frameUrl || !isMainFrame) return false
  try {
    // Not `URL.origin`: Node reports "null" for custom schemes such as app://.
    const url = new URL(frameUrl)
    return `${url.protocol}//${url.host}` === appOrigin
  } catch {
    return false
  }
}

export interface IpcDeps {
  readonly ipcMain: Pick<IpcMain, 'handle'>
  readonly windowFor: (sender: WebContents) => BrowserWindow | null
  readonly pickFolder: (window: BrowserWindow | null) => Promise<string | null>
  /** Origin of the renderer page: the dev server, or `app://co-write`. */
  readonly appOrigin: string
  readonly userDataDir: string
  readonly cipher: Cipher
}

/** Per-window project state: the only folder that window's file calls may touch. */
interface ProjectSession {
  readonly root: string
  readonly stopWatching: () => void
}

const NoArgs = z.tuple([])

export function registerIpc(deps: IpcDeps): void {
  const projects = new Map<number, ProjectSession>()
  const docStateDir = join(deps.userDataDir, 'doc-state')
  const credentialsFile = join(deps.userDataDir, 'credentials.bin')

  /** Registers a handler that checks the sender and parses its arguments before running. */
  const handle = <Schema extends z.ZodType<readonly unknown[]>, Result>(
    channel: string,
    schema: Schema,
    run: (event: IpcMainInvokeEvent, args: z.infer<Schema>) => Promise<Result>,
  ): void => {
    deps.ipcMain.handle(channel, async (event, ...raw: unknown[]) => {
      const frame = event.senderFrame
      const isMainFrame = frame !== null && frame === event.sender.mainFrame
      if (!isTrustedSender(frame?.url, isMainFrame, deps.appOrigin)) {
        throw new UntrustedSenderError(frame?.url ?? '<gone>')
      }
      return run(event, schema.parse(raw))
    })
  }

  const rootOf = (event: IpcMainInvokeEvent): string => {
    const project = projects.get(event.sender.id)
    if (!project) throw new Error('No project is open')
    return project.root
  }

  const info = async (root: string): Promise<ProjectInfo> => ({
    name: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
    tree: await listTree(root),
  })

  handle(IpcChannel.openProject, NoArgs, async (event) => {
    const root = await deps.pickFolder(deps.windowFor(event.sender))
    if (!root) return null
    projects.get(event.sender.id)?.stopWatching()
    const sender = event.sender
    const stopWatching = watchProject(root, (change: ProjectChange) => {
      if (!sender.isDestroyed()) sender.send(IpcChannel.projectChanged, change)
    })
    projects.set(sender.id, { root, stopWatching })
    sender.once('destroyed', () => {
      projects.get(sender.id)?.stopWatching()
      projects.delete(sender.id)
    })
    return info(root)
  })

  handle(IpcChannel.listProject, NoArgs, async (event) => {
    const project = projects.get(event.sender.id)
    return project ? info(project.root) : null
  })

  handle(IpcChannel.readFile, z.tuple([RelativePathSchema]), async (event, [path]) =>
    readProjectFile(rootOf(event), path),
  )

  handle(
    IpcChannel.saveFile,
    z.tuple([RelativePathSchema, FileContentSchema]),
    async (event, [path, content]) => saveProjectFile(rootOf(event), path, content),
  )

  handle(IpcChannel.createFile, z.tuple([RelativePathSchema]), async (event, [path]) =>
    createProjectFile(rootOf(event), path),
  )

  const stateFile = (event: IpcMainInvokeEvent, ref: DocRef): string =>
    docStateFile(docStateDir, ref, ref.kind === 'local' ? rootOf(event) : null)

  handle(IpcChannel.loadDocState, z.tuple([DocRefSchema]), async (event, [ref]) =>
    loadBytes(stateFile(event, ref)),
  )

  handle(
    IpcChannel.storeDocState,
    z.tuple([DocRefSchema, DocStateSchema]),
    async (event, [ref, state]) => storeBytes(stateFile(event, ref), state),
  )

  handle(IpcChannel.loadCredentials, NoArgs, async () =>
    loadCredentials(credentialsFile, deps.cipher),
  )

  handle(IpcChannel.storeCredentials, z.tuple([CredentialsSchema]), async (_event, [credentials]) =>
    storeCredentials(credentialsFile, deps.cipher, credentials),
  )

  handle(IpcChannel.clearCredentials, NoArgs, async () => removeFile(credentialsFile))
}
