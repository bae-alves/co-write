import { createDfaModel } from '@/kit/dfa'

export type Column = 'files' | 'source' | 'preview'

export type DialogKind = 'new-file' | 'new-shared' | 'share' | 'sign-in'

export interface Dialog {
  readonly kind: DialogKind
  /** A submit is in flight. */
  readonly busy: boolean
  /** Why the last submit failed. */
  readonly error: string | null
}

export interface Columns {
  readonly files: boolean
  readonly source: boolean
  readonly preview: boolean
}

/** The window's arrangement: which of the three columns show, and which dialog (if any) is up. */
export type Workbench =
  | { readonly tag: 'loading' }
  | { readonly tag: 'ready'; readonly columns: Columns; readonly dialog: Dialog | null }

export const DEFAULT_COLUMNS: Columns = { files: true, source: true, preview: true }

/**
 *   loading ─► ready ─┐
 *                ▲    │ (any change of columns or dialog)
 *                └────┘
 */
export const useWorkbench = createDfaModel<Workbench>(
  { tag: 'loading' },
  { loading: ['ready'], ready: ['ready'] },
)
