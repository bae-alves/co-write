import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServerStatusIntents } from './intent'
import { useServerStatus } from './model'
import type { ServerStatusRepository } from './repository'

const info = {
  auth: 'accounts' as const,
  oauth: [{ id: 'github', label: 'GitHub' }],
  version: '1.2.3',
}

function setup(
  health: ServerStatusRepository['health'],
  overrides: Partial<ServerStatusRepository> = {},
) {
  const instanceKnown = vi.fn()
  const repository: ServerStatusRepository = {
    hasServer: () => true,
    health,
    instance: async () => info,
    probe: vi.fn(async () => info),
    setServer: vi.fn(async () => {}),
    ...overrides,
  }
  const intents = createServerStatusIntents({
    model: useServerStatus,
    repository,
    now: () => 42,
    instanceKnown,
  })
  return { intents, repository, instanceKnown, state: () => useServerStatus.getState().state }
}

beforeEach(() => {
  useServerStatus.setState(useServerStatus.getInitialState(), true)
})

describe('checkServer', () => {
  it('goes online when the repository reports healthy', async () => {
    const { intents, state } = setup(async () => ({ version: '1.2.3' }))
    await intents.checkServer()
    expect(state()).toEqual({
      tag: 'online',
      version: '1.2.3',
      auth: 'accounts',
      oauth: info.oauth,
      checkedAt: 42,
    })
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

describe('what the server is', () => {
  it('tells the account whether there are accounts', async () => {
    const { intents, instanceKnown } = setup(async () => ({ version: '1.2.3' }))
    await intents.checkServer()
    expect(instanceKnown).toHaveBeenCalledWith(info)
  })

  it('is offline when the server does not say what it is', async () => {
    const { intents, state, instanceKnown } = setup(async () => ({ version: '1' }), {
      instance: async () => {
        throw new Error('This does not look like a co-write server')
      },
    })
    await intents.checkServer()
    expect(state()).toMatchObject({
      tag: 'offline',
      reason: 'This does not look like a co-write server',
    })
    expect(instanceKnown).not.toHaveBeenCalled()
  })

  it('works locally when no server is chosen', async () => {
    const health = vi.fn(async () => ({ version: '1' }))
    const { intents, state } = setup(health, { hasServer: () => false })
    await intents.checkServer()
    expect(state()).toEqual({ tag: 'unset' })
    expect(health).not.toHaveBeenCalled()
  })
})

describe('connect', () => {
  it('asks the server what it is, then chooses it', async () => {
    const { intents, repository } = setup(async () => ({ version: '1' }))
    expect(await intents.connect('  https://write.example.com ')).toBeNull()
    expect(repository.probe).toHaveBeenCalledWith('https://write.example.com')
    expect(repository.setServer).toHaveBeenCalledWith('https://write.example.com')
  })

  it('does not choose a server that is not co-write, and says why', async () => {
    const { intents, repository } = setup(async () => ({ version: '1' }), {
      probe: async () => {
        throw new Error(
          "Error invoking remote method 'server:probe': Error: https://x.example does not look like a co-write server.",
        )
      },
    })
    expect(await intents.connect('https://x.example')).toBe(
      'https://x.example does not look like a co-write server.',
    )
    expect(repository.setServer).not.toHaveBeenCalled()
  })

  it('needs an address', async () => {
    const { intents, repository } = setup(async () => ({ version: '1' }))
    expect(await intents.connect('  ')).toBe('Enter the server address.')
    expect(repository.probe).not.toHaveBeenCalled()
  })

  it('can forget the server', async () => {
    const { intents, repository } = setup(async () => ({ version: '1' }))
    expect(await intents.disconnect()).toBeNull()
    expect(repository.setServer).toHaveBeenCalledWith(null)
  })
})
