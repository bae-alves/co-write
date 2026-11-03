import { createDfaModel } from '@/kit/dfa'

export type Account =
  | { readonly tag: 'restoring' }
  | { readonly tag: 'signedOut'; readonly error: string | null }
  | { readonly tag: 'signingIn'; readonly username: string }
  | { readonly tag: 'signedIn'; readonly username: string; readonly token: string }
  /**
   * An open instance (`auth: none`) has no accounts: everyone is an editor of every document. All
   * there is to choose is the name shown on your cursor (null until chosen).
   */
  | { readonly tag: 'anonymous'; readonly name: string | null }

/**
 *   restoring ─► signedIn ◄──┐
 *       │  │        │  │     │
 *       │  └─► signedOut ◄───┤
 *       │         │  ▲  │    │
 *       │         ▼  │  └────┴──► anonymous ⟲   (the server turned out to have no accounts)
 *       │       signingIn ──────┘
 *       └──────────────────────────► anonymous
 */
export const useAccount = createDfaModel<Account>(
  { tag: 'restoring' },
  {
    restoring: ['signedIn', 'signedOut', 'anonymous'],
    signedOut: ['signingIn', 'signedOut', 'anonymous'],
    signingIn: ['signedIn', 'signedOut'],
    signedIn: ['signedOut', 'anonymous'],
    anonymous: ['signedOut', 'anonymous'],
  },
)
