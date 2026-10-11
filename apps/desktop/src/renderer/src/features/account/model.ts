import { createDfaModel } from '@/kit/dfa'

export type Account =
  | { readonly tag: 'restoring' }
  | { readonly tag: 'signedOut'; readonly error: string | null }
  | { readonly tag: 'signingIn'; readonly username: string }
  | { readonly tag: 'signedIn'; readonly username: string; readonly token: string }

/**
 *   restoring ─► signedIn ◄──┐
 *       │           │        │
 *       └─► signedOut ◄──────┤
 *              │  ▲          │
 *              ▼  │          │
 *            signingIn ──────┘
 */
export const useAccount = createDfaModel<Account>(
  { tag: 'restoring' },
  {
    restoring: ['signedIn', 'signedOut'],
    signedOut: ['signingIn', 'signedOut'],
    signingIn: ['signedIn', 'signedOut'],
    signedIn: ['signedOut'],
  },
)
