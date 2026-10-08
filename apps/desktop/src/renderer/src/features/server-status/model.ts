import { createDfaModel } from '@/kit/dfa'

export type ServerStatus =
  | { readonly tag: 'idle' }
  | { readonly tag: 'checking' }
  | { readonly tag: 'online'; readonly version: string; readonly checkedAt: number }
  | { readonly tag: 'offline'; readonly reason: string; readonly checkedAt: number }

/**
 *   idle ─► checking ─► online ─┐
 *              ▲  └───► offline ┤
 *              └────────────────┘
 */
export const useServerStatus = createDfaModel<ServerStatus>(
  { tag: 'idle' },
  {
    idle: ['checking'],
    checking: ['online', 'offline'],
    online: ['checking'],
    offline: ['checking'],
  },
)
