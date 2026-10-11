import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/server/repository'
import { createAccountIntents } from './intent'
import { useAccount } from './model'
import type { AccountRepository } from './repository'

function fakeRepository(overrides: Partial<AccountRepository> = {}): AccountRepository {
  return {
    register: vi.fn(async ({ username }) => ({ username, token: 'new-token' })),
    login: vi.fn(async ({ username }) => ({ username, token: 'tok' })),
    logout: vi.fn(async () => {}),
    whoAmI: vi.fn(async () => 'ana'),
    loadCredentials: vi.fn(async () => null),
    storeCredentials: vi.fn(async () => {}),
    clearCredentials: vi.fn(async () => {}),
    ...overrides,
  }
}

const state = () => useAccount.getState().state
const setup = (repository = fakeRepository()) => ({
  repository,
  intents: createAccountIntents({ model: useAccount, repository }),
})

beforeEach(() => {
  useAccount.setState(useAccount.getInitialState(), true)
})

describe('restore', () => {
  it('is signed out when nothing was saved', async () => {
    await setup().intents.restore()
    expect(state()).toEqual({ tag: 'signedOut', error: null })
  })

  it('signs in with a saved token the server still accepts', async () => {
    const { intents } = setup(
      fakeRepository({ loadCredentials: async () => ({ username: 'ana', token: 't' }) }),
    )
    await intents.restore()
    expect(state()).toEqual({ tag: 'signedIn', username: 'ana', token: 't' })
  })

  it('forgets a token the server rejects', async () => {
    const repository = fakeRepository({
      loadCredentials: async () => ({ username: 'ana', token: 't' }),
      whoAmI: async () => {
        throw new ApiError(401, 'Unauthorized')
      },
    })
    await setup(repository).intents.restore()
    expect(state().tag).toBe('signedOut')
    expect(repository.clearCredentials).toHaveBeenCalled()
  })

  it('keeps the saved session while the server is unreachable', async () => {
    const { intents } = setup(
      fakeRepository({
        loadCredentials: async () => ({ username: 'ana', token: 't' }),
        whoAmI: async () => {
          throw new ApiError(0, 'Server unreachable')
        },
      }),
    )
    await intents.restore()
    expect(state()).toEqual({ tag: 'signedIn', username: 'ana', token: 't' })
  })
})

describe('signIn / signOut', () => {
  beforeEach(() => useAccount.getState().go({ tag: 'signedOut', error: null }))

  it('logs in, stores the session and trims the username', async () => {
    const { intents, repository } = setup()
    expect(await intents.signIn('login', '  ana ', 'pw')).toBeNull()
    expect(repository.login).toHaveBeenCalledWith({ username: 'ana', password: 'pw' })
    expect(repository.storeCredentials).toHaveBeenCalledWith({ username: 'ana', token: 'tok' })
    expect(state()).toEqual({ tag: 'signedIn', username: 'ana', token: 'tok' })
  })

  it('registers', async () => {
    const { intents, repository } = setup()
    await intents.signIn('register', 'bo', 'pw')
    expect(repository.register).toHaveBeenCalled()
    expect(state()).toMatchObject({ tag: 'signedIn', token: 'new-token' })
  })

  it('shows the server error', async () => {
    const { intents } = setup(
      fakeRepository({
        login: async () => {
          throw new ApiError(401, 'Wrong username or password')
        },
      }),
    )
    expect(await intents.signIn('login', 'ana', 'nope')).toBe('Wrong username or password')
    expect(state()).toEqual({ tag: 'signedOut', error: 'Wrong username or password' })
  })

  it('refuses empty input without calling the server', async () => {
    const { intents, repository } = setup()
    await intents.signIn('login', ' ', 'pw')
    expect(repository.login).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ tag: 'signedOut', error: expect.any(String) })
  })

  it('signs out and forgets the session', async () => {
    const { intents, repository } = setup()
    await intents.signIn('login', 'ana', 'pw')
    await intents.signOut()
    expect(state()).toEqual({ tag: 'signedOut', error: null })
    expect(repository.logout).toHaveBeenCalledWith('tok')
    expect(repository.clearCredentials).toHaveBeenCalled()
  })
})
