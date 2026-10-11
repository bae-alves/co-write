import type { MenuCommand } from '@co-write/shared'
import { desktopApi } from '@/server/repository'

export interface CommandsRepository {
  /** Native menu items (and their accelerators) chosen by the user. */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}

export const commandsRepository: CommandsRepository = {
  onMenuCommand: (listener) => desktopApi()?.onMenuCommand(listener) ?? (() => {}),
}
