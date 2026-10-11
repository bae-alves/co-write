import type { FileNode } from '@co-write/shared'
import { createDfaModel } from '@/kit/dfa'

export type Project =
  | { readonly tag: 'none'; readonly error: string | null }
  | { readonly tag: 'opening' }
  | {
      readonly tag: 'open'
      readonly name: string
      readonly tree: readonly FileNode[]
      /** Folders the user collapsed in the file list. */
      readonly collapsed: readonly string[]
    }

/**
 *   none ─► opening ─► open ⟲ (tree changes, folds)
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
