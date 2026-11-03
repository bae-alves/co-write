import { beforeEach, describe, expect, it } from 'vitest'
import { capabilitiesOf, fileKindOf, type Capabilities } from '@co-write/shared'
import { createWorkbenchIntents, effectiveColumns, lockOf } from './intent'
import { useWorkbench } from './model'
import type { ColumnPrefs, WorkbenchRepository } from './repository'

const caps = (name: string): Capabilities => capabilitiesOf(fileKindOf(name)!)

function setup(
  saved: Partial<ColumnPrefs> | null = null,
  capabilities?: () => Capabilities | null,
) {
  const stored: ColumnPrefs[] = []
  const repository: WorkbenchRepository = {
    loadColumns: () => saved,
    storeColumns: (columns) => stored.push(columns),
  }
  const intents = createWorkbenchIntents({ model: useWorkbench, repository, capabilities })
  return { intents, stored, state: () => useWorkbench.getState().state }
}

beforeEach(() => {
  useWorkbench.setState(useWorkbench.getInitialState(), true)
})

describe('workbench intents', () => {
  it('shows all three columns by default', () => {
    const { intents, state } = setup()
    intents.load()
    expect(state()).toEqual({
      tag: 'ready',
      columns: { files: true, source: true, preview: true },
      dialog: null,
    })
  })

  it('restores saved columns, ignoring missing keys', () => {
    const { intents, state } = setup({ files: false })
    intents.load()
    expect(state()).toMatchObject({ columns: { files: false, source: true, preview: true } })
  })

  it('toggles a column and remembers it', () => {
    const { intents, state, stored } = setup()
    intents.toggle('preview')
    expect(state()).toMatchObject({ columns: { preview: false } })
    intents.toggle('preview')
    expect(state()).toMatchObject({ columns: { preview: true } })
    expect(stored).toEqual([
      { files: true, source: true, preview: false },
      { files: true, source: true, preview: true },
    ])
  })

  it('can hide a column for this window only', () => {
    const { intents, state, stored } = setup()
    intents.setVisible('files', false, { remember: false })
    expect(state()).toMatchObject({ columns: { files: false } })
    expect(stored).toEqual([])
  })

  it('never hides both source and preview', () => {
    const { intents, state, stored } = setup()
    intents.toggle('preview')
    intents.toggle('source')
    expect(state()).toMatchObject({ columns: { source: true, preview: false } })
    intents.toggle('files')
    expect(state()).toMatchObject({ columns: { files: false } })
    expect(stored).toHaveLength(2)
  })

  it('repairs a saved layout with neither source nor preview', () => {
    const { intents, state } = setup({ source: false, preview: false })
    intents.load()
    expect(state()).toMatchObject({ columns: { source: true, preview: false } })
  })

  it('follows a column dragged shut or open', () => {
    const { intents, state } = setup()
    intents.setVisible('files', false)
    expect(state()).toMatchObject({ columns: { files: false } })
    intents.setVisible('files', true)
    expect(state()).toMatchObject({ columns: { files: true } })
  })

  it('reveals a hidden column without touching visible ones', () => {
    const { intents, state, stored } = setup({ source: false })
    intents.reveal('source')
    intents.reveal('files')
    expect(state()).toMatchObject({ columns: { files: true, source: true } })
    expect(stored).toHaveLength(1)
  })

  it('opens and closes dialogs', () => {
    const { intents, state } = setup()
    intents.openDialog('sign-in')
    expect(state()).toMatchObject({ dialog: { kind: 'sign-in', busy: false, error: null } })
    intents.closeDialog()
    expect(state()).toMatchObject({ dialog: null })
  })

  it('closes a dialog whose action succeeds', async () => {
    const { intents, state } = setup()
    intents.openDialog('new-file')
    let finish!: (value: string | null) => void
    const pending = intents.submitDialog(() => new Promise((resolve) => (finish = resolve)))
    expect(state()).toMatchObject({ dialog: { busy: true } })
    finish(null)
    await pending
    expect(state()).toMatchObject({ dialog: null })
  })

  it('keeps a dialog open with a notice when its action worked but is not done', async () => {
    const { intents, state } = setup()
    intents.openDialog('sign-in')
    await intents.submitDialog(async () => ({ notice: 'Public key copied.' }))
    expect(state()).toMatchObject({
      dialog: { kind: 'sign-in', busy: false, error: null, notice: 'Public key copied.' },
    })
    await intents.submitDialog(async () => 'Nope')
    expect(state()).toMatchObject({ dialog: { error: 'Nope', notice: null } })
  })

  it('keeps a dialog open with the error when its action fails', async () => {
    const { intents, state } = setup()
    intents.openDialog('new-file')
    await intents.submitDialog(async () => 'File exists')
    expect(state()).toMatchObject({
      dialog: { kind: 'new-file', busy: false, error: 'File exists' },
    })
    await intents.submitDialog(async () => {
      throw new Error('boom')
    })
    expect(state()).toMatchObject({ dialog: { error: 'boom' } })
  })
})

describe('columns per file type', () => {
  const all = { files: true, source: true, preview: true }

  it('shows only the columns a file has', () => {
    expect(effectiveColumns(all, caps('a.md'))).toEqual(all)
    expect(effectiveColumns(all, caps('a.json'))).toEqual({
      files: true,
      source: true,
      preview: false,
    })
    expect(effectiveColumns(all, caps('a.pdf'))).toEqual({
      files: true,
      source: false,
      preview: true,
    })
    expect(effectiveColumns(all, null)).toEqual(all)
  })

  it('falls back to the file’s own column when the user’s choice leaves nothing', () => {
    expect(effectiveColumns({ ...all, source: false }, caps('a.json'))).toEqual({
      files: true,
      source: true,
      preview: false,
    })
    expect(effectiveColumns({ ...all, preview: false }, caps('a.pdf'))).toEqual({
      files: true,
      source: false,
      preview: true,
    })
  })

  it('says why a toggle does nothing', () => {
    expect(lockOf(all, caps('a.json'), 'preview')).toBe('unavailable')
    expect(lockOf(all, caps('a.json'), 'source')).toBe('last')
    expect(lockOf(all, caps('a.pdf'), 'source')).toBe('unavailable')
    expect(lockOf(all, caps('a.md'), 'source')).toBeNull()
    expect(lockOf(all, caps('a.json'), 'files')).toBeNull()
  })

  it('leaves the remembered layout alone when the file has no such column', () => {
    const { intents, state, stored } = setup(null, () => caps('a.pdf'))
    intents.toggle('source')
    expect(state()).toMatchObject({ columns: { source: true, preview: true } })
    expect(stored).toEqual([])
    intents.toggle('files')
    expect(state()).toMatchObject({ columns: { files: false } })
  })

  it('toggles what the file has, relative to what is showing', () => {
    const { intents, state } = setup({ preview: false }, () => caps('a.md'))
    intents.toggle('preview')
    expect(state()).toMatchObject({ columns: { source: true, preview: true } })
  })
})
