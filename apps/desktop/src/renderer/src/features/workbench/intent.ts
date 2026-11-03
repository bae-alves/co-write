import type { Capabilities } from '@co-write/shared'
import { capabilitiesOfState, useDocument } from '@/features/document/model'
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

/**
 * The columns the window actually shows: the user's choice, limited to what the open file has.
 * A PDF has no source, a JSON file no preview; if the user's choice would leave nothing, the
 * file's own columns show instead. Their layout choice itself is left alone.
 */
export function effectiveColumns(columns: Columns, capabilities: Capabilities | null): Columns {
  if (!capabilities) return columns
  const source = columns.source && capabilities.source
  const preview = columns.preview && capabilities.preview
  if (!source && !preview) {
    return { ...columns, source: capabilities.source, preview: capabilities.preview }
  }
  return { ...columns, source, preview }
}

/** Why a column's toggle does nothing for the open file: it has no such column, or it is the last. */
export function lockOf(
  columns: Columns,
  capabilities: Capabilities | null,
  column: Column,
): 'unavailable' | 'last' | null {
  if (column === 'files') return null
  if (capabilities && !capabilities[column]) return 'unavailable'
  const shown = effectiveColumns(columns, capabilities)
  return shown[column] && !canHide(shown, column) ? 'last' : null
}

const sane = (columns: Columns): Columns =>
  columns.source || columns.preview ? columns : { ...columns, source: true }

export interface WorkbenchDeps {
  readonly model: typeof useWorkbench
  readonly repository: WorkbenchRepository
  /** The columns the open file uses; null when nothing is open. */
  readonly capabilities?: () => Capabilities | null
}

export function createWorkbenchIntents({
  model,
  repository,
  capabilities = () => null,
}: WorkbenchDeps) {
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
      const state = ready()
      if (lockOf(state.columns, capabilities(), column) !== null) return
      this.setVisible(column, !effectiveColumns(state.columns, capabilities())[column])
    },

    setVisible(column: Column, visible: boolean, { remember = true } = {}): void {
      const state = ready()
      if (state.columns[column] === visible) return
      if (!visible && !canHide(state.columns, column)) {
        // Re-issue the current state so a column dragged shut springs back open.
        return model.getState().go({ ...state, columns: { ...state.columns } })
      }
      const columns = { ...state.columns, [column]: visible }
      model.getState().go({ ...state, columns })
      if (remember) repository.storeColumns(columns)
    },

    /** Makes a column visible (e.g. opening a file brings the source back). */
    reveal(column: Column): void {
      this.setVisible(column, true)
    },

    openDialog(kind: DialogKind): void {
      model.getState().go({ ...ready(), dialog: { kind, busy: false, error: null } })
    },

    /**
     * Runs a dialog's action: busy while it runs, closed when it returns null, kept open with the
     * returned message when it returns one, and kept open with a notice when it returns
     * `{ notice }` (the action worked but there is more to do in the dialog).
     */
    async submitDialog(action: () => Promise<string | null | { notice: string }>): Promise<void> {
      const before = ready().dialog
      if (!before || before.busy) return
      model
        .getState()
        .go({ ...ready(), dialog: { ...before, busy: true, error: null, notice: null } })
      const outcome = await action().catch((e: unknown) =>
        e instanceof Error ? e.message : String(e),
      )
      const now = ready()
      if (now.dialog?.kind !== before.kind) return // closed or replaced meanwhile
      const dialog =
        outcome === null
          ? null
          : typeof outcome === 'string'
            ? { ...now.dialog, busy: false, error: outcome, notice: null }
            : { ...now.dialog, busy: false, error: null, notice: outcome.notice }
      model.getState().go({ ...now, dialog })
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
  capabilities: () => capabilitiesOfState(useDocument.getState().state),
})
