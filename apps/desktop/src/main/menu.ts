import { IpcChannel, type MenuCommand } from '@co-write/shared'
import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

const send = (command: MenuCommand) => () => {
  BrowserWindow.getFocusedWindow()?.webContents.send(IpcChannel.menuCommand, command)
}

/** Native menus. Items that act on the document are forwarded to the focused renderer. */
export function installMenu(isDev: boolean): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'Ctrl+O', click: send('open-folder') },
        { label: 'New File…', accelerator: 'Ctrl+N', click: send('new-file') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'Ctrl+S', click: send('save') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Files', accelerator: 'Ctrl+B', click: send('toggle-files') },
        { label: 'Toggle Source', accelerator: 'Ctrl+Shift+E', click: send('toggle-source') },
        {
          label: 'Toggle Preview',
          accelerator: 'Ctrl+Shift+V',
          click: send('toggle-preview'),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
