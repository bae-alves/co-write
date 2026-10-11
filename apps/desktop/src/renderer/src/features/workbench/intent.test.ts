import { beforeEach, describe, expect, it } from 'vitest'
import { createWorkbenchIntents } from './intent'
import { useWorkbench } from './model'
import type { ColumnPrefs, WorkbenchRepository } from './repository'

function setup(saved: Partial<ColumnPrefs> | null = null) {
  const stored: ColumnPrefs[] = []
  const repository: WorkbenchRepository = {
    loadColumns: () => saved,
    storeColumns: (columns) => stored.push(columns),
  }
  const intents = createWorkbenchIntents({ model: useWorkbench, repository })
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
