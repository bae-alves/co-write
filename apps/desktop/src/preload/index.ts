import type { CoWriteApi, MenuCommand, ProjectChange } from '@co-write/shared'
import { IpcChannel } from '@co-write/shared/channels'
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * The renderer's entire view of the privileged world. Each function maps to one validated
 * handler in main; nothing generic (no channel names, no raw ipcRenderer) crosses the bridge.
 */
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const api: CoWriteApi = {
  openProject: () => ipcRenderer.invoke(IpcChannel.openProject),
  listProject: () => ipcRenderer.invoke(IpcChannel.listProject),
  openFileFolder: () => ipcRenderer.invoke(IpcChannel.openFileFolder),
  readFile: (path) => ipcRenderer.invoke(IpcChannel.readFile, path),
  readBinary: (path) => ipcRenderer.invoke(IpcChannel.readBinary, path),
  saveFile: (path, content) => ipcRenderer.invoke(IpcChannel.saveFile, path, content),
  createFile: (path) => ipcRenderer.invoke(IpcChannel.createFile, path),
  loadDocState: (ref) => ipcRenderer.invoke(IpcChannel.loadDocState, ref),
  storeDocState: (ref, state) => ipcRenderer.invoke(IpcChannel.storeDocState, ref, state),
  loadCredentials: () => ipcRenderer.invoke(IpcChannel.loadCredentials),
  storeCredentials: (credentials) => ipcRenderer.invoke(IpcChannel.storeCredentials, credentials),
  clearCredentials: () => ipcRenderer.invoke(IpcChannel.clearCredentials),
  getServer: () => ipcRenderer.invoke(IpcChannel.getServer),
  setServer: (url) => ipcRenderer.invoke(IpcChannel.setServer, url),
  probeServer: (url) => ipcRenderer.invoke(IpcChannel.probeServer, url),
  keyInfo: () => ipcRenderer.invoke(IpcChannel.keyInfo),
  generateKey: (replace) => ipcRenderer.invoke(IpcChannel.generateKey, replace === true),
  importKey: () => ipcRenderer.invoke(IpcChannel.importKey),
  exportKey: () => ipcRenderer.invoke(IpcChannel.exportKey),
  signWithKey: (input) => ipcRenderer.invoke(IpcChannel.signWithKey, input),
  oauthSignIn: (request) => ipcRenderer.invoke(IpcChannel.oauthSignIn, request),
  onProjectChanged: (listener) => subscribe<ProjectChange>(IpcChannel.projectChanged, listener),
  onMenuCommand: (listener) => subscribe<MenuCommand>(IpcChannel.menuCommand, listener),
}

contextBridge.exposeInMainWorld('api', api)
