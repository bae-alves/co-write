import { ApiError } from '@/server/repository'
import { useAccount, type Account } from './model'
import { accountRepository, type AccountRepository } from './repository'

export interface AccountDeps {
  readonly model: typeof useAccount
  readonly repository: AccountRepository
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong'

export function createAccountIntents({ model, repository }: AccountDeps) {
  const go = (next: Account) => model.getState().go(next)

  return {
    /** Picks up the session saved by the last run. Offline, the saved session is trusted as is. */
    async restore(): Promise<void> {
      if (model.getState().state.tag !== 'restoring') return
      const saved = await repository.loadCredentials().catch(() => null)
      if (!saved) return go({ tag: 'signedOut', error: null })
      try {
        const username = await repository.whoAmI(saved.token)
        go({ tag: 'signedIn', username, token: saved.token })
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await repository.clearCredentials().catch(() => {})
          go({ tag: 'signedOut', error: 'Your session expired. Sign in again.' })
        } else {
          go({ tag: 'signedIn', username: saved.username, token: saved.token })
        }
      }
    },

    /** Returns why signing in failed, or null on success. */
    async signIn(
      mode: 'login' | 'register',
      username: string,
      password: string,
    ): Promise<string | null> {
      if (!model.getState().can('signingIn')) return 'Already signing in.'
      const name = username.trim()
      if (!name || !password) {
        const error = 'Enter a username and a password.'
        go({ tag: 'signedOut', error })
        return error
      }
      go({ tag: 'signingIn', username: name })
      try {
        const request = { username: name, password }
        const session =
          mode === 'register' ? await repository.register(request) : await repository.login(request)
        await repository.storeCredentials(session).catch(() => {})
        go({ tag: 'signedIn', username: session.username, token: session.token })
        return null
      } catch (error) {
        go({ tag: 'signedOut', error: message(error) })
        return message(error)
      }
    },

    async signOut(): Promise<void> {
      const state = model.getState().state
      if (state.tag !== 'signedIn') return
      go({ tag: 'signedOut', error: null })
      await Promise.allSettled([repository.logout(state.token), repository.clearCredentials()])
    },

    /** The server refused the token (another feature saw a 401). */
    async sessionRejected(): Promise<void> {
      if (model.getState().state.tag !== 'signedIn') return
      go({ tag: 'signedOut', error: 'Your session expired. Sign in again.' })
      await repository.clearCredentials().catch(() => {})
    },
  }
}

export const accountIntents = createAccountIntents({
  model: useAccount,
  repository: accountRepository,
})
