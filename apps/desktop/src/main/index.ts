import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron'
import { buildCsp } from './csp'
import { registerIpc } from './ipc'
import { installMenu } from './menu'
import { launchTarget } from './project'
import { loadServerSetting } from './settings'
import { APP_ORIGIN, APP_SCHEME, resolveAppAsset } from './protocol'
import icon from '../../resources/icon.png?asset'

const DEV_URL = process.env['ELECTRON_RENDERER_URL']
const RENDERER_DIR = join(__dirname, '../renderer')

// One process: launching again (another file from the file manager) opens a window here.
if (!app.requestSingleInstanceLock()) app.exit()

// Must happen before `ready`: `app://` behaves like https (secure context, fetch, origin).
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: 'co-write',
    backgroundColor: '#1D0F14',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // The renderer never opens windows or navigates away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`)
  return win
}

void app.whenReady().then(async () => {
  // The server is chosen at runtime (Connect to server…) and kept in settings.json; the CSP's
  // `connect-src` follows it. `CO_WRITE_SERVER` seeds it until the user chooses one.
  const server = await loadServerSetting(
    join(app.getPath('userData'), 'settings.json'),
    process.env['CO_WRITE_SERVER'] ?? null,
  )
  const policy = () => buildCsp({ dev: Boolean(DEV_URL), serverOrigin: server.origin() })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy()] },
    })
  })
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppAsset(RENDERER_DIR, request.url)
    if (!file) return new Response('Not found', { status: 404 })
    const response = await net.fetch(pathToFileURL(file).href)
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', policy())
    // Module scripts and workers (pdf.js) are refused unless served as JavaScript.
    if (/\.m?js$/.test(file)) headers.set('Content-Type', 'text/javascript')
    return new Response(response.body, { status: response.status, headers })
  })
  // No camera, microphone, notifications, … for the renderer.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  )

  const ipc = registerIpc({
    ipcMain,
    windowFor: (sender) => BrowserWindow.fromWebContents(sender),
    pickFolder: async (window) => {
      const options = { title: 'Open Folder', properties: ['openDirectory' as const] }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    appOrigin: DEV_URL ? new URL(DEV_URL).origin : APP_ORIGIN,
    userDataDir: app.getPath('userData'),
    server,
    // Every window reloads, so each one connects to the new server under its new CSP.
    onServerChanged: () => BrowserWindow.getAllWindows().forEach((win) => win.webContents.reload()),
    pickKeyToImport: async (window) => {
      const options = {
        title: 'Import key',
        properties: ['openFile' as const],
        filters: [
          { name: 'PEM private key', extensions: ['pem', 'key'] },
          { name: 'All files', extensions: ['*'] },
        ],
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    pickKeyExportPath: async (window) => {
      const options = { title: 'Export key', defaultPath: 'co-write-key.pem' }
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      return result.canceled ? null : (result.filePath ?? null)
    },
    openExternal: async (url) => {
      // Only the OAuth start URL main built itself, and only over http(s).
      if (!/^https?:\/\//.test(url)) throw new Error('Refusing to open a non-web address.')
      await shell.openExternal(url)
    },
    cipher: {
      get available() {
        return safeStorage.isEncryptionAvailable()
      },
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (bytes) => safeStorage.decryptString(Buffer.from(bytes)),
    },
  })
  installMenu(Boolean(DEV_URL))

  // argv is `co-write [path]` packaged and `electron . [path]` in development.
  const openWindow = async (argv: readonly string[], cwd: string): Promise<void> => {
    const target = await launchTarget(argv.slice(app.isPackaged ? 1 : 2), cwd)
    const win = createWindow()
    if (target) ipc.openLaunchTarget(win.webContents, target)
  }
  app.on('second-instance', (_event, argv, cwd) => void openWindow(argv, cwd))
  void openWindow(process.argv, process.cwd())
})

// Linux only: closing the last window quits.
app.on('window-all-closed', () => app.quit())
