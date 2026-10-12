import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session } from 'electron'
import { buildCsp } from './csp'
import { registerIpc } from './ipc'
import { installMenu } from './menu'
import { launchTarget } from './project'
import { APP_ORIGIN, APP_SCHEME, resolveAppAsset } from './protocol'
import icon from '../../resources/icon.png?asset'

const SERVER_ORIGIN = import.meta.env.MAIN_VITE_SERVER_URL ?? 'http://localhost:8080'
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

void app.whenReady().then(() => {
  const csp = buildCsp({ dev: Boolean(DEV_URL), serverOrigin: SERVER_ORIGIN })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    })
  })
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppAsset(RENDERER_DIR, request.url)
    if (!file) return new Response('Not found', { status: 404 })
    const response = await net.fetch(pathToFileURL(file).href)
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', csp)
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
