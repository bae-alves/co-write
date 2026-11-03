import { useAccount } from '@/features/account/model'
import { accountIntents } from '@/features/account/intent'
import { sharedDocsIntents } from '@/features/shared-docs/intent'
import { messageOf } from '@/kit/errors'
import { useSecurity, type Security } from './model'
import { securityRepository, type SecurityRepository } from './repository'

export interface SecurityDeps {
  readonly model: typeof useSecurity
  readonly repository: SecurityRepository
  readonly account: typeof useAccount
  /** Deletes the account on the server (and what it owns). Returns an error, or null. */
  readonly deleteAccount: () => Promise<string | null>
  /** Hands a document the user owns to another user. Returns an error, or null. */
  readonly transferOwnership: (docId: string, username: string) => Promise<string | null>
  /** The account is gone: sign out locally. */
  readonly accountDeleted: () => Promise<void>
}

/** Keys, linked providers and the account itself. Everything here needs a signed-in account. */
export function createSecurityIntents({
  model,
  repository,
  account,
  deleteAccount,
  transferOwnership,
  accountDeleted,
}: SecurityDeps) {
  const go = (next: Security) => model.getState().go(next)
  const credentials = () => {
    const state = account.getState().state
    return state.tag === 'signedIn' ? state : null
  }

  async function load(notice: string | null, error: string | null): Promise<void> {
    const me = credentials()
    if (!me) return go({ tag: 'closed' })
    const [keys, identities, local] = await Promise.allSettled([
      repository.keys(me.token),
      repository.identities(me.token),
      repository.localKey(),
    ])
    if (model.getState().state.tag !== 'loading') return // closed meanwhile
    const failure = [keys, identities].find((result) => result.status === 'rejected')
    go({
      tag: 'ready',
      keys: keys.status === 'fulfilled' ? keys.value : [],
      identities: identities.status === 'fulfilled' ? identities.value : [],
      local: local.status === 'fulfilled' ? local.value : null,
      busy: false,
      error: error ?? (failure?.status === 'rejected' ? messageOf(failure.reason) : null),
      notice,
    })
  }

  /** Runs one action: busy while it runs, then everything is read again with its outcome. */
  async function act(
    task: (token: string) => Promise<string | null | void>,
    notice: string | null = null,
  ): Promise<void> {
    const me = credentials()
    const now = model.getState().state
    if (!me || now.tag !== 'ready' || now.busy) return
    go({ ...now, busy: true, error: null, notice: null })
    let error: string | null = null
    let message = notice
    try {
      const outcome = await task(me.token)
      if (typeof outcome === 'string') {
        message = outcome
      }
    } catch (failure) {
      error = messageOf(failure)
      message = null
    }
    if (model.getState().state.tag === 'closed') return
    go({ tag: 'loading' })
    await load(message, error)
  }

  const intents = {
    async open(): Promise<void> {
      if (!credentials() || !model.getState().can('loading')) return
      go({ tag: 'loading' })
      await load(null, null)
    },

    close(): void {
      if (model.getState().state.tag !== 'closed') go({ tag: 'closed' })
    },

    /** Adds another device's public key (its PEM) to the account. */
    addKey(publicKey: string, label: string): Promise<void> {
      if (!publicKey.trim())
        return act(async () => Promise.reject(new Error('Paste the other device’s public key.')))
      return act(async (token) => {
        await repository.addKey(token, { publicKey: publicKey.trim(), label: label.trim() })
        return 'Key added. That device can sign in now.'
      })
    },

    removeKey(id: number): Promise<void> {
      return act(async (token) => {
        await repository.removeKey(token, id)
        return 'Key removed. Sessions it started have ended.'
      })
    },

    async linkProvider(provider: string): Promise<void> {
      await act(async (token) => {
        const linkIntent = await repository.linkIntent(token)
        await repository.linkProvider({ provider, linkIntent })
        return `${provider} linked.`
      })
    },

    unlinkProvider(provider: string): Promise<void> {
      return act(async (token) => {
        await repository.unlinkProvider(token, provider)
        return `${provider} unlinked.`
      })
    },

    createLocalKey(): Promise<void> {
      return act(async () => {
        await repository.createLocalKey()
        return 'Key created. Add it to your account from a device that can sign in, or register with it.'
      })
    },

    importLocalKey(): Promise<void> {
      return act(async () => ((await repository.importLocalKey()) ? 'Key imported.' : null))
    },

    exportLocalKey(): Promise<void> {
      return act(async () =>
        (await repository.exportLocalKey()) ? 'Private key saved. Keep that file secret.' : null,
      )
    },

    copyLocalPublicKey(): Promise<void> {
      return act(async () => {
        const key = await repository.localKey()
        if (!key) throw new Error('This machine has no key yet.')
        await repository.copyText(key.publicKey)
        return 'Public key copied.'
      })
    },

    /** Gives one of your documents to someone else, so deleting your account does not take it along. */
    transferOwnership(docId: string, username: string): Promise<void> {
      return act(async () => {
        const error = await transferOwnership(docId, username)
        if (error) throw new Error(error)
        return `Handed the document to ${username.trim()}.`
      })
    },

    /** Deletes the account for good. `confirmation` must be the username, typed out. */
    async deleteAccount(confirmation: string): Promise<void> {
      const me = credentials()
      if (!me) return
      if (confirmation.trim().toLowerCase() !== me.username.toLowerCase()) {
        const now = model.getState().state
        if (now.tag === 'ready') {
          go({ ...now, error: `Type your username (${me.username}) to confirm.`, notice: null })
        }
        return
      }
      await act(async () => {
        const error = await deleteAccount()
        if (error) throw new Error(error)
        await accountDeleted()
        return null
      })
    },
  }
  return intents
}

export type SecurityIntents = ReturnType<typeof createSecurityIntents>

export const securityIntents = createSecurityIntents({
  model: useSecurity,
  repository: securityRepository,
  account: useAccount,
  deleteAccount: () => sharedDocsIntents.deleteAccount(),
  transferOwnership: (docId, username) => sharedDocsIntents.transferOwnership(docId, username),
  accountDeleted: () => accountIntents.accountDeleted(),
})
