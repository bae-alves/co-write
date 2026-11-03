import type { InstanceInfo } from '@co-write/shared'
import { accountIntents } from '@/features/account/intent'
import { messageOf } from '@/kit/errors'
import { useServerStatus } from './model'
import { serverStatusRepository, type ServerStatusRepository } from './repository'

export interface ServerStatusDeps {
  readonly model: typeof useServerStatus
  readonly repository: ServerStatusRepository
  readonly now: () => number
  /** Told what the server is each time it answers, so the account follows (accounts or open). */
  readonly instanceKnown?: (info: InstanceInfo) => void
}

/** Everything the user can ask for, and everything that happens as a result. */
export function createServerStatusIntents({
  model,
  repository,
  now,
  instanceKnown,
}: ServerStatusDeps) {
  return {
    async checkServer(): Promise<void> {
      if (!model.getState().can('checking')) return // a check is already in flight
      if (!repository.hasServer()) return model.getState().go({ tag: 'unset' })
      model.getState().go({ tag: 'checking' })
      try {
        const { version } = await repository.health()
        const info = await repository.instance()
        model.getState().go({
          tag: 'online',
          version,
          auth: info.auth,
          oauth: info.oauth,
          checkedAt: now(),
        })
        instanceKnown?.(info)
      } catch (error) {
        model.getState().go({ tag: 'offline', reason: messageOf(error), checkedAt: now() })
      }
    },

    /**
     * Chooses a server: asks it what it is first, so a typo or a web page that is not co-write is
     * refused here. On success the window reloads to connect to it. Returns an error, or null.
     */
    async connect(url: string): Promise<string | null> {
      const address = url.trim()
      if (!address) return 'Enter the server address.'
      try {
        await repository.probe(address)
        await repository.setServer(address)
        return null
      } catch (error) {
        return messageOf(error)
      }
    },

    /** Forgets the server: back to local-only. The window reloads. */
    async disconnect(): Promise<string | null> {
      try {
        await repository.setServer(null)
        return null
      } catch (error) {
        return messageOf(error)
      }
    },
  }
}

export const serverStatusIntents = createServerStatusIntents({
  model: useServerStatus,
  repository: serverStatusRepository,
  now: Date.now,
  instanceKnown: (info) => accountIntents.applyInstance(info),
})
