import {
  DEFAULT_COLUMNS,
  useWorkbench,
  type Column,
  type Columns,
  type DialogKind,
  type Workbench,
} from './model'
import { workbenchRepository, type WorkbenchRepository } from './repository'

/** Source or preview must stay visible: a window with only a file list has nothing to show. */
export function canHide(columns: Columns, column: Column): boolean {
  if (column === 'files') return true
  return column === 'source' ? columns.preview : columns.source
}

const sane = (columns: Columns): Columns =>
  columns.source || columns.preview ? columns : { ...columns, source: true }

export interface WorkbenchDeps {
  readonly model: typeof useWorkbench
  readonly repository: WorkbenchRepository
}

export function createWorkbenchIntents({ model, repository }: WorkbenchDeps) {
  const ready = (): Extract<Workbench, { tag: 'ready' }> => {
    const state = model.getState().state
    if (state.tag === 'ready') return state
    const next = {
      tag: 'ready' as const,
      columns: sane({ ...DEFAULT_COLUMNS, ...repository.loadColumns() }),
      dialog: null,
    }
    model.getState().go(next)
    return next
  }

  return {
    /** Restores the column layout the user left last time. */
    load(): void {
      ready()
    },

    toggle(column: Column): void {
      this.setVisible(column, !ready().columns[column])
    },

    setVisible(column: Column, visible: boolean): void {
      const state = ready()
      if (state.columns[column] === visible) return
      if (!visible && !canHide(state.columns, column)) {
        // Re-issue the current state so a column dragged shut springs back open.
        return model.getState().go({ ...state, columns: { ...state.columns } })
      }
      const columns = { ...state.columns, [column]: visible }
      model.getState().go({ ...state, columns })
      repository.storeColumns(columns)
    },

    /** Makes a column visible (e.g. opening a file brings the source back). */
    reveal(column: Column): void {
      this.setVisible(column, true)
    },

    openDialog(kind: DialogKind): void {
      model.getState().go({ ...ready(), dialog: { kind, busy: false, error: null } })
    },

    /**
     * Runs a dialog's action: busy while it runs, closed when it returns null, kept open with
     * the returned message otherwise.
     */
    async submitDialog(action: () => Promise<string | null>): Promise<void> {
      const before = ready().dialog
      if (!before || before.busy) return
      model.getState().go({ ...ready(), dialog: { ...before, busy: true, error: null } })
      const error = await action().catch((e: unknown) =>
        e instanceof Error ? e.message : String(e),
      )
      const now = ready()
      if (now.dialog?.kind !== before.kind) return // closed or replaced meanwhile
      model.getState().go({ ...now, dialog: error ? { ...now.dialog, busy: false, error } : null })
    },

    closeDialog(): void {
      const state = ready()
      if (state.dialog) model.getState().go({ ...state, dialog: null })
    },
  }
}

export const workbenchIntents = createWorkbenchIntents({
  model: useWorkbench,
  repository: workbenchRepository,
})
