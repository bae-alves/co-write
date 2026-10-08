import { useServerStatus } from './model'
import { serverStatusRepository, type ServerStatusRepository } from './repository'

export interface ServerStatusDeps {
  readonly model: typeof useServerStatus
  readonly repository: ServerStatusRepository
  readonly now: () => number
}

/** Everything the user can ask for, and everything that happens as a result. */
export function createServerStatusIntents({ model, repository, now }: ServerStatusDeps) {
  return {
    async checkServer(): Promise<void> {
      if (!model.getState().can('checking')) return // a check is already in flight
      model.getState().go({ tag: 'checking' })
      try {
        const { version } = await repository.health()
        model.getState().go({ tag: 'online', version, checkedAt: now() })
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error'
        model.getState().go({ tag: 'offline', reason, checkedAt: now() })
      }
    },
  }
}

export const serverStatusIntents = createServerStatusIntents({
  model: useServerStatus,
  repository: serverStatusRepository,
  now: Date.now,
})
