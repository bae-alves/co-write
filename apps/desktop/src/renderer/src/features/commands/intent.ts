import type { MenuCommand } from '@co-write/shared'
import { documentIntents } from '@/features/document/intent'
import { projectIntents } from '@/features/project/intent'
import { workbenchIntents } from '@/features/workbench/intent'
import { commandsRepository, type CommandsRepository } from './repository'

/** Undoes the open document, unless a text field (search, dialog) has focus. */
function history(action: 'undo' | 'redo') {
  return () => {
    if (document.activeElement?.matches('input, textarea')) document.execCommand(action)
    else documentIntents.binding()?.undoManager[action]()
  }
}

export interface CommandsDeps {
  readonly repository: CommandsRepository
  readonly run: Record<MenuCommand, () => void>
}

/** Routes native menu commands to the feature intents that handle them. No state of its own. */
export function createCommandIntents({ repository, run }: CommandsDeps) {
  return {
    dispatch(command: MenuCommand): void {
      run[command]()
    },
    listen(): () => void {
      return repository.onMenuCommand((command) => this.dispatch(command))
    },
  }
}

export const commandIntents = createCommandIntents({
  repository: commandsRepository,
  run: {
    'open-folder': () => void projectIntents.openFolder(),
    'new-file': () => workbenchIntents.openDialog('new-file'),
    save: () => void documentIntents.save(),
    undo: history('undo'),
    redo: history('redo'),
    'toggle-files': () => workbenchIntents.toggle('files'),
    'toggle-source': () => workbenchIntents.toggle('source'),
    'toggle-preview': () => workbenchIntents.toggle('preview'),
  },
})
