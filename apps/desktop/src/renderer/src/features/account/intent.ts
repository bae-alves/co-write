import type { InstanceInfo } from '@co-write/shared'
import { messageOf } from '@/kit/errors'
import { ApiError } from '@/server/repository'
import { useAccount, type Account } from './model'
import { accountRepository, type AccountRepository } from './repository'

export interface AccountDeps {
  readonly model: typeof useAccount
  readonly repository: AccountRepository
}

const MAX_NAME = 32

export function createAccountIntents({ model, repository }: AccountDeps) {
  const go = (next: Account) => model.getState().go(next)
  const tag = () => model.getState().state.tag

  /** Runs a sign-in; on success keeps the session on disk and signs in. Returns an error, or null. */
  async function beginSession(
    label: string,
    obtain: () => Promise<{ username: string; token: string }>,
  ): Promise<string | null> {
    if (!model.getState().can('signingIn')) return 'Already signing in.'
    go({ tag: 'signingIn', username: label })
    try {
      const session = await obtain()
      await repository.storeCredentials(session).catch(() => {})
      go({ tag: 'signedIn', username: session.username, token: session.token })
      return null
    } catch (error) {
      const reason = messageOf(error)
      go({ tag: 'signedOut', error: reason })
      return reason
    }
  }

  const checkName = (username: string): string | null =>
    username.trim() ? null : 'Enter a username.'

  const intents = {
    /** Picks up the session saved by the last run. Offline, the saved session is trusted as is. */
    async restore(): Promise<void> {
      if (tag() !== 'restoring') return
      const saved = await repository.loadCredentials().catch(() => null)
      if (tag() !== 'restoring') return
      if (!saved) return go({ tag: 'signedOut', error: null })
      try {
        const username = await repository.whoAmI(saved.token)
        if (tag() === 'restoring') go({ tag: 'signedIn', username, token: saved.token })
      } catch (error) {
        if (tag() !== 'restoring') return
        if (error instanceof ApiError && error.status === 401) {
          await repository.clearCredentials().catch(() => {})
          go({ tag: 'signedOut', error: 'Your session expired. Sign in again.' })
        } else {
          go({ tag: 'signedIn', username: saved.username, token: saved.token })
        }
      }
    },

    /** The server answered: an open instance has no accounts, an ordinary one does. */
    applyInstance(info: InstanceInfo): void {
      const now = model.getState().state
      if (info.auth === 'none') {
        if (now.tag === 'anonymous') return
        if (now.tag === 'signingIn') return
        go({ tag: 'anonymous', name: repository.loadDisplayName() })
      } else if (now.tag === 'anonymous') {
        go({ tag: 'signedOut', error: null })
      }
    },

    /** Sets the name shown on your cursor on an open instance. Returns an error, or null. */
    setDisplayName(raw: string): string | null {
      const name = raw.trim()
      if (!name) return 'Enter a name.'
      if (name.length > MAX_NAME) return `Names are at most ${MAX_NAME} characters.`
      if (tag() !== 'anonymous') return 'This server has accounts; there is no display name to set.'
      repository.storeDisplayName(name)
      go({ tag: 'anonymous', name })
      return null
    },

    /** Signs in with this machine's key. Returns why it failed, or null on success. */
    async signIn(username: string): Promise<string | null> {
      const problem = checkName(username)
      if (problem) {
        go({ tag: 'signedOut', error: problem })
        return problem
      }
      const name = username.trim()
      return beginSession(name, async () => {
        if (!(await repository.keyInfo())) {
          throw new Error(
            'This machine has no key yet. Create an account here, or import your key.',
          )
        }
        const { nonce } = await repository.challenge()
        const signature = await repository.sign({ purpose: 'login', nonce })
        return repository.login({ username: name, nonce, signature })
      })
    },

    /** Creates an account with this machine's key (made first if needed). */
    async register(username: string): Promise<string | null> {
      const problem = checkName(username)
      if (problem) {
        go({ tag: 'signedOut', error: problem })
        return problem
      }
      const name = username.trim()
      return beginSession(name, async () => {
        const key = (await repository.keyInfo()) ?? (await repository.generateKey())
        const { nonce } = await repository.challenge()
        const signature = await repository.sign({
          purpose: 'register',
          nonce,
          username: name.toLowerCase(),
        })
        return repository.register({ username: name, publicKey: key.publicKey, nonce, signature })
      })
    },

    /** Signs in through the system browser with an OAuth provider (GitHub, SSO, …). */
    async signInWithProvider(provider: string): Promise<string | null> {
      return beginSession(provider, () => repository.oauthSignIn(provider))
    },

    /** Puts this machine's public key on the clipboard, to add it to an account on another device. */
    async copyPublicKey(): Promise<string | null> {
      try {
        const key = await repository.keyInfo()
        if (!key) return 'This machine has no key yet.'
        await repository.copyText(key.publicKey)
        return null
      } catch (error) {
        return messageOf(error)
      }
    },

    /**
     * Adopts a key exported from another machine, so an account made there signs in here.
     * Returns an error, a message, or null when the user cancelled.
     */
    async importKey(): Promise<{ message: string | null; error: string | null }> {
      try {
        const key = await repository.importKey()
        return { message: key ? `Key imported (${key.fingerprint}).` : null, error: null }
      } catch (error) {
        return { message: null, error: messageOf(error) }
      }
    },

    async signOut(): Promise<void> {
      const state = model.getState().state
      if (state.tag !== 'signedIn') return
      go({ tag: 'signedOut', error: null })
      await Promise.allSettled([repository.logout(state.token), repository.clearCredentials()])
    },

    /** The account is gone (deleted): forget the session without asking the server. */
    async accountDeleted(): Promise<void> {
      if (tag() !== 'signedIn') return
      go({ tag: 'signedOut', error: null })
      await repository.clearCredentials().catch(() => {})
    },

    /** The server refused the token (another feature saw a 401). */
    async sessionRejected(): Promise<void> {
      if (tag() !== 'signedIn') return
      go({ tag: 'signedOut', error: 'Your session expired. Sign in again.' })
      await repository.clearCredentials().catch(() => {})
    },
  }
  return intents
}

export const accountIntents = createAccountIntents({
  model: useAccount,
  repository: accountRepository,
})
