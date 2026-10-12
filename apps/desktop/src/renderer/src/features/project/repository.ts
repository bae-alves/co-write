import type { ProjectChange, ProjectInfo } from '@co-write/shared'
import { desktopApi } from '@/server/repository'

export interface ProjectRepository {
  /** Asks the user for a folder; null when they cancel. */
  pickAndOpen(): Promise<ProjectInfo | null>
  /** The folder this window already has open (e.g. after a renderer reload). */
  current(): Promise<ProjectInfo | null>
  /** File mode → folder mode. */
  openFileFolder(): Promise<ProjectInfo | null>
  createFile(path: string): Promise<void>
  onChange(listener: (change: ProjectChange) => void): () => void
}

const noop = () => {}

export function createProjectRepository(): ProjectRepository {
  const api = () => {
    const value = desktopApi()
    if (!value) throw new Error('Opening folders needs the desktop app')
    return value
  }
  return {
    pickAndOpen: () => api().openProject(),
    current: async () => (await desktopApi()?.listProject()) ?? null,
    openFileFolder: () => api().openFileFolder(),
    createFile: (path) => api().createFile(path),
    onChange: (listener) => desktopApi()?.onProjectChanged(listener) ?? noop,
  }
}

export const projectRepository = createProjectRepository()
