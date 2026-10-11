import type { DocumentSummary } from '@co-write/shared'
import { createDfaModel } from '@/kit/dfa'

export type SharedDocs =
  | { readonly tag: 'hidden' }
  | { readonly tag: 'loading'; readonly docs: readonly DocumentSummary[] }
  | { readonly tag: 'ready'; readonly docs: readonly DocumentSummary[] }
  | { readonly tag: 'failed'; readonly docs: readonly DocumentSummary[]; readonly reason: string }

/**
 * The server's document list for the signed-in user. Hidden while signed out.
 *
 *   hidden ─► loading ─► ready ─┐
 *     ▲          ▲  └──► failed ┤
 *     │          └──────────────┘
 *     └──────── (sign out, from anywhere)
 */
export const useSharedDocs = createDfaModel<SharedDocs>(
  { tag: 'hidden' },
  {
    hidden: ['loading', 'hidden'],
    loading: ['ready', 'failed', 'hidden'],
    ready: ['loading', 'hidden'],
    failed: ['loading', 'hidden'],
  },
)
