import type { OAuthProvider } from '@co-write/shared'
import { createDfaModel } from '@/kit/dfa'

export type ServerStatus =
  | { readonly tag: 'idle' }
  /** No server chosen yet: everything works locally, nothing online is offered. */
  | { readonly tag: 'unset' }
  | { readonly tag: 'checking' }
  | {
      readonly tag: 'online'
      readonly version: string
      /** `none`: no accounts, every document open to everyone. `accounts`: sign in with a key or a provider. */
      readonly auth: 'none' | 'accounts'
      readonly oauth: readonly OAuthProvider[]
      readonly checkedAt: number
    }
  | { readonly tag: 'offline'; readonly reason: string; readonly checkedAt: number }

/**
 *   idle ─► checking ─► online ─┐
 *     │        ▲  └───► offline ┤
 *     ▼        └────────────────┘
 *   unset ◄──────────────(no server chosen; any state may find that out)
 */
export const useServerStatus = createDfaModel<ServerStatus>(
  { tag: 'idle' },
  {
    idle: ['checking', 'unset'],
    unset: ['checking', 'unset'],
    checking: ['online', 'offline', 'unset'],
    online: ['checking', 'unset'],
    offline: ['checking', 'unset'],
  },
)
