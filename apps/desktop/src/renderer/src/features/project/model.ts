import type { FileNode } from '@co-write/shared'
import { createDfaModel } from '@/kit/dfa'

export type Project =
  | { readonly tag: 'none'; readonly error: string | null }
  | { readonly tag: 'opening' }
  | {
      readonly tag: 'open'
      readonly name: string
      readonly tree: readonly FileNode[]
      /** File mode: only this file is open. Null in folder mode. */
      readonly file: string | null
      /** Folders the user collapsed in the file list. */
      readonly collapsed: readonly string[]
    }

/**
 *   none ─► opening ─► open ⟲ (tree changes, folds, file mode → folder mode)
 *    ▲         │        │
 *    └─────────┘        └─► opening (another folder)
 */
export const useProject = createDfaModel<Project>(
  { tag: 'none', error: null },
  {
    none: ['opening', 'none'],
    opening: ['open', 'none'],
    open: ['open', 'opening'],
  },
)
