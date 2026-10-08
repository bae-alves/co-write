import { join } from 'node:path'
import { app, BrowserWindow, session } from 'electron'
import { buildCsp } from './csp'

const SERVER_ORIGIN = import.meta.env.MAIN_VITE_SERVER_URL ?? 'http://localhost:8080'
const DEV_URL = process.env['ELECTRON_RENDERER_URL']

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // The renderer never opens windows or navigates away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) event.preventDefault()
  })

  if (DEV_URL) void win.loadURL(DEV_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(() => {
  const csp = buildCsp({ dev: Boolean(DEV_URL), serverOrigin: SERVER_ORIGIN })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    })
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
