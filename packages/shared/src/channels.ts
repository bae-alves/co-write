/**
 * The IPC contract between the renderer (via preload) and the main process.
 *
 * Every request channel has a payload schema; main parses every payload with it before acting
 * (the renderer is treated as untrusted). The preload exposes exactly the functions in
 * `CoWriteApi`: no raw `ipcRenderer`, no generic `invoke(channel, ...)`.
 *
 * Kept free of runtime dependencies: the sandboxed preload imports only this file.
 */
export const IpcChannel = {
  openProject: 'project:open',
  listProject: 'project:list',
  readFile: 'file:read',
  saveFile: 'file:save',
  createFile: 'file:create',
  loadDocState: 'doc-state:load',
  storeDocState: 'doc-state:store',
  loadCredentials: 'credentials:load',
  storeCredentials: 'credentials:store',
  clearCredentials: 'credentials:clear',
  /** main → renderer: the project tree or a file in it changed on disk. */
  projectChanged: 'project:changed',
  /** main → renderer: a native menu item was chosen. */
  menuCommand: 'menu:command',
} as const
