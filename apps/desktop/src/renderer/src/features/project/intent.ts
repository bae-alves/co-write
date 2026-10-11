import type { ProjectChange, ProjectInfo } from '@co-write/shared'
import { documentIntents } from '@/features/document/intent'
import { workbenchIntents } from '@/features/workbench/intent'
import { useProject, type Project } from './model'
import { projectRepository, type ProjectRepository } from './repository'

export interface ProjectDeps {
  readonly model: typeof useProject
  readonly repository: ProjectRepository
  readonly documents: {
    openLocal(path: string): Promise<void>
    fileChangedOnDisk(path: string): Promise<void>
    close(): Promise<void>
  }
  readonly revealSource: () => void
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** `name` → a safe relative Markdown path: no leading slashes, no `..`, `.md` added if missing. */
export function normalizeNewFileName(name: string): string | null {
  const parts = name
    .trim()
    .split(/[\\/]+/)
    .filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..')) return null
  const path = parts.join('/')
  return /\.(md|markdown|mdown|mkd)$/i.test(path) ? path : `${path}.md`
}

export function createProjectIntents({ model, repository, documents, revealSource }: ProjectDeps) {
  const go = (next: Project) => model.getState().go(next)
  const show = (info: ProjectInfo) => {
    const now = model.getState().state
    go({
      tag: 'open',
      name: info.name,
      tree: info.tree,
      collapsed: now.tag === 'open' && now.name === info.name ? now.collapsed : [],
    })
  }

  return {
    /** Re-attaches to the folder main already has open (after a reload). */
    async restore(): Promise<void> {
      const info = await repository.current().catch(() => null)
      if (!info || model.getState().state.tag !== 'none') return
      go({ tag: 'opening' })
      show(info)
    },

    async openFolder(): Promise<void> {
      const before = model.getState().state
      if (before.tag === 'opening') return
      go({ tag: 'opening' })
      try {
        const info = await repository.pickAndOpen()
        if (!info) {
          // Cancelled: go back to where we were.
          if (before.tag === 'open') return go({ ...before })
          return go({ tag: 'none', error: null })
        }
        await documents.close()
        show(info)
      } catch (error) {
        return go({ tag: 'none', error: message(error) })
      }
    },

    applyChange(change: ProjectChange): void {
      const now = model.getState().state
      if (now.tag !== 'open') return
      if (change.kind === 'tree') go({ ...now, tree: change.tree })
      else void documents.fileChangedOnDisk(change.path)
    },

    toggleFolder(path: string): void {
      const now = model.getState().state
      if (now.tag !== 'open') return
      const collapsed = now.collapsed.includes(path)
        ? now.collapsed.filter((p) => p !== path)
        : [...now.collapsed, path]
      go({ ...now, collapsed })
    },

    async openFile(path: string): Promise<void> {
      revealSource()
      await documents.openLocal(path)
    },

    /** Creates `name` in the project and opens it. Returns an error message, or null. */
    async createFile(name: string): Promise<string | null> {
      if (model.getState().state.tag !== 'open') return 'Open a folder first.'
      const path = normalizeNewFileName(name)
      if (!path) return 'Enter a file name inside the project.'
      try {
        await repository.createFile(path)
      } catch (error) {
        return message(error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      }
      await this.openFile(path)
      return null
    },

    /** Wires main-process events (file system changes) into intents. Returns a stop function. */
    listen(): () => void {
      return repository.onChange((change) => this.applyChange(change))
    },
  }
}

export const projectIntents = createProjectIntents({
  model: useProject,
  repository: projectRepository,
  documents: documentIntents,
  revealSource: () => workbenchIntents.reveal('source'),
})
