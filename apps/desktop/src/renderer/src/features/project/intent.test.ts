import type { ProjectInfo } from '@co-write/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectIntents, normalizeNewFileName } from './intent'
import { useProject } from './model'
import type { ProjectRepository } from './repository'

const info: ProjectInfo = {
  name: 'notes',
  tree: [
    {
      name: 'docs',
      path: 'docs',
      kind: 'dir',
      children: [{ name: 'a.md', path: 'docs/a.md', kind: 'file' }],
    },
    { name: 'readme.md', path: 'readme.md', kind: 'file' },
  ],
}

function setup(overrides: Partial<ProjectRepository> = {}) {
  const repository: ProjectRepository = {
    pickAndOpen: vi.fn(async () => info),
    current: vi.fn(async () => null),
    createFile: vi.fn(async () => {}),
    onChange: vi.fn(() => () => {}),
    ...overrides,
  }
  const documents = {
    openLocal: vi.fn(async () => {}),
    fileChangedOnDisk: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
  const revealSource = vi.fn()
  const intents = createProjectIntents({ model: useProject, repository, documents, revealSource })
  return { intents, repository, documents, revealSource }
}

const state = () => useProject.getState().state

beforeEach(() => {
  useProject.setState(useProject.getInitialState(), true)
})

describe('project intents', () => {
  it('opens a folder and closes the previous document', async () => {
    const { intents, documents } = setup()
    await intents.openFolder()
    expect(state()).toEqual({ tag: 'open', name: 'notes', tree: info.tree, collapsed: [] })
    expect(documents.close).toHaveBeenCalled()
  })

  it('returns to the previous state when the picker is cancelled', async () => {
    const { intents, repository, documents } = setup()
    await intents.openFolder()
    vi.mocked(repository.pickAndOpen).mockResolvedValueOnce(null)
    documents.close.mockClear()
    await intents.openFolder()
    expect(state()).toMatchObject({ tag: 'open', name: 'notes' })
    expect(documents.close).not.toHaveBeenCalled()
  })

  it('reports a failure to open', async () => {
    const { intents } = setup({
      pickAndOpen: async () => {
        throw new Error('nope')
      },
    })
    await intents.openFolder()
    expect(state()).toEqual({ tag: 'none', error: 'nope' })
  })

  it('restores the folder main already has open', async () => {
    const { intents } = setup({ current: async () => info })
    await intents.restore()
    expect(state()).toMatchObject({ tag: 'open', name: 'notes' })
  })

  it('applies tree changes and forwards file changes to the document', async () => {
    const { intents, documents } = setup()
    await intents.openFolder()
    intents.applyChange({ kind: 'tree', tree: [] })
    expect(state()).toMatchObject({ tree: [] })
    intents.applyChange({ kind: 'file', path: 'readme.md' })
    expect(documents.fileChangedOnDisk).toHaveBeenCalledWith('readme.md')
  })

  it('folds and unfolds folders', async () => {
    const { intents } = setup()
    await intents.openFolder()
    intents.toggleFolder('docs')
    expect(state()).toMatchObject({ collapsed: ['docs'] })
    intents.toggleFolder('docs')
    expect(state()).toMatchObject({ collapsed: [] })
  })

  it('opens files and brings the source column back', async () => {
    const { intents, documents, revealSource } = setup()
    await intents.openFile('docs/a.md')
    expect(revealSource).toHaveBeenCalled()
    expect(documents.openLocal).toHaveBeenCalledWith('docs/a.md')
  })

  it('creates and opens a new file', async () => {
    const { intents, repository, documents } = setup()
    await intents.openFolder()
    expect(await intents.createFile('ideas/today')).toBeNull()
    expect(repository.createFile).toHaveBeenCalledWith('ideas/today.md')
    expect(documents.openLocal).toHaveBeenCalledWith('ideas/today.md')
  })

  it('explains why a file could not be created', async () => {
    const { intents } = setup({
      createFile: async () => {
        throw new Error(
          "Error invoking remote method 'file:create': Error: EEXIST: file already exists",
        )
      },
    })
    expect(await intents.createFile('a.md')).toBe('Open a folder first.')
    await intents.openFolder()
    expect(await intents.createFile('..')).toBe('Enter a file name inside the project.')
    expect(await intents.createFile('a.md')).toBe('EEXIST: file already exists')
  })
})

describe('normalizeNewFileName', () => {
  it.each([
    ['notes', 'notes.md'],
    ['  a/b.markdown ', 'a/b.markdown'],
    ['/abs//path.md', 'abs/path.md'],
    ['a\\b', 'a/b.md'],
    ['./x', 'x.md'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeNewFileName(input)).toBe(expected)
  })

  it.each(['', '   ', '../escape', 'a/../../b', '.'])('rejects %j', (input) => {
    expect(normalizeNewFileName(input)).toBeNull()
  })
})
