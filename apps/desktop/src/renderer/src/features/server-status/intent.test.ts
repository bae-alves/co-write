import { beforeEach, describe, expect, it } from 'vitest'
import { createServerStatusIntents } from './intent'
import { useServerStatus } from './model'
import type { ServerStatusRepository } from './repository'

function setup(health: ServerStatusRepository['health']) {
  const intents = createServerStatusIntents({
    model: useServerStatus,
    repository: { health },
    now: () => 42,
  })
  return { intents, state: () => useServerStatus.getState().state }
}

beforeEach(() => {
  useServerStatus.setState(useServerStatus.getInitialState(), true)
})

describe('checkServer', () => {
  it('goes online when the repository reports healthy', async () => {
    const { intents, state } = setup(async () => ({ version: '1.2.3' }))
    await intents.checkServer()
    expect(state()).toEqual({ tag: 'online', version: '1.2.3', checkedAt: 42 })
  })

  it('goes offline with the failure reason', async () => {
    const { intents, state } = setup(async () => {
      throw new Error('boom')
    })
    await intents.checkServer()
    expect(state()).toEqual({ tag: 'offline', reason: 'boom', checkedAt: 42 })
  })

  it('shows checking while the request is in flight', async () => {
    let finish!: () => void
    const { intents, state } = setup(
      () => new Promise((resolve) => (finish = () => resolve({ version: 'x' }))),
    )
    const pending = intents.checkServer()
    expect(state().tag).toBe('checking')
    finish()
    await pending
    expect(state().tag).toBe('online')
  })

  it('ignores a second request while one is in flight', async () => {
    let calls = 0
    let finish!: () => void
    const { intents } = setup(() => {
      calls += 1
      return new Promise((resolve) => (finish = () => resolve({ version: 'x' })))
    })
    const first = intents.checkServer()
    await intents.checkServer()
    finish()
    await first
    expect(calls).toBe(1)
  })

  it('can re-check after going offline', async () => {
    let healthy = false
    const { intents, state } = setup(async () => {
      if (!healthy) throw new Error('down')
      return { version: 'ok' }
    })
    await intents.checkServer()
    expect(state().tag).toBe('offline')
    healthy = true
    await intents.checkServer()
    expect(state().tag).toBe('online')
  })
})
