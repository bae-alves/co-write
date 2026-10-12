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
  type LaunchTarget,
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
  /** File mode: the one file in `root` this window may touch. Null in folder mode. */
  readonly file: string | null
  readonly stopWatching: () => void
}

const NoArgs = z.tuple([])

export function registerIpc(deps: IpcDeps): {
  /** `co-write <path>`: opens a folder (folder mode) or one file (file mode) before the renderer asks. */
  openLaunchTarget(sender: WebContents, target: LaunchTarget): void
} {
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

  /** The root `path` resolves against, once it is clear the window may touch `path` at all. */
  const rootFor = (event: IpcMainInvokeEvent, path: string): string => {
    const project = projects.get(event.sender.id)
    if (!project) throw new Error('No project is open')
    if (project.file !== null && path !== project.file) {
      throw new Error(`Only ${project.file} is open; open its folder first`)
    }
    return project.root
  }

  const info = async ({
    root,
    file,
  }: Omit<ProjectSession, 'stopWatching'>): Promise<ProjectInfo> => ({
    name: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
    ...(file === null
      ? { tree: await listTree(root) }
      : { tree: [{ name: file, path: file, kind: 'file' as const }], file }),
  })

  const attach = (sender: WebContents, root: string, file: string | null): void => {
    projects.get(sender.id)?.stopWatching()
    const stopWatching = watchProject(
      root,
      (change: ProjectChange) => {
        if (!sender.isDestroyed()) sender.send(IpcChannel.projectChanged, change)
      },
      file,
    )
    projects.set(sender.id, { root, file, stopWatching })
    sender.once('destroyed', () => {
      projects.get(sender.id)?.stopWatching()
      projects.delete(sender.id)
    })
  }

  handle(IpcChannel.openProject, NoArgs, async (event) => {
    const root = await deps.pickFolder(deps.windowFor(event.sender))
    if (!root) return null
    attach(event.sender, root, null)
    return info({ root, file: null })
  })

  // Widens a window from its file to the folder holding it; the user asked for exactly that one.
  handle(IpcChannel.openFileFolder, NoArgs, async (event) => {
    const project = projects.get(event.sender.id)
    if (!project) return null
    if (project.file !== null) attach(event.sender, project.root, null)
    return info({ root: project.root, file: null })
  })

  handle(IpcChannel.listProject, NoArgs, async (event) => {
    const project = projects.get(event.sender.id)
    if (!project) return null
    return info(project)
  })

  handle(IpcChannel.readFile, z.tuple([RelativePathSchema]), async (event, [path]) =>
    readProjectFile(rootFor(event, path), path),
  )

  handle(
    IpcChannel.saveFile,
    z.tuple([RelativePathSchema, FileContentSchema]),
    async (event, [path, content]) => saveProjectFile(rootFor(event, path), path, content),
  )

  handle(IpcChannel.createFile, z.tuple([RelativePathSchema]), async (event, [path]) =>
    createProjectFile(rootFor(event, path), path),
  )

  const stateFile = (event: IpcMainInvokeEvent, ref: DocRef): string =>
    docStateFile(docStateDir, ref, ref.kind === 'local' ? rootFor(event, ref.path) : null)

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

  return {
    openLaunchTarget(sender, target) {
      attach(sender, target.root, target.file)
    },
  }
}
