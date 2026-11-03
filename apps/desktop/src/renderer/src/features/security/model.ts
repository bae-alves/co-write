import type { KeyInfo, KeySummary, LinkedIdentity } from '@co-write/shared'
import { createDfaModel } from '@/kit/dfa'

export type Security =
  | { readonly tag: 'closed' }
  | { readonly tag: 'loading' }
  | {
      readonly tag: 'ready'
      /** The keys the account accepts (one per machine, usually). */
      readonly keys: readonly KeySummary[]
      /** OAuth providers linked to the account. */
      readonly identities: readonly LinkedIdentity[]
      /** This machine's own key, if it has one. */
      readonly local: KeyInfo | null
      /** An action is in flight. */
      readonly busy: boolean
      readonly error: string | null
      readonly notice: string | null
    }

/**
 *   closed ─► loading ─► ready ⟲   (every action reloads: ready ─► loading ─► ready)
 *      ▲          │         │
 *      └──────────┴─────────┘
 */
export const useSecurity = createDfaModel<Security>(
  { tag: 'closed' },
  { closed: ['loading'], loading: ['ready', 'closed'], ready: ['ready', 'loading', 'closed'] },
)
