import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/server/repository'
import { createAccountIntents } from './intent'
import { useAccount } from './model'
import type { AccountRepository } from './repository'

const key = {
  publicKey: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----\n',
  fingerprint: 'SHA256:abc',
  protected: true,
}

function fakeRepository(overrides: Partial<AccountRepository> = {}): AccountRepository {
  let stored: string | null = null
  return {
    challenge: vi.fn(async () => ({ nonce: 'nonce-1', expiresAt: 1 })),
    register: vi.fn(async ({ username }) => ({ username, token: 'new-token' })),
    login: vi.fn(async ({ username }) => ({ username, token: 'tok' })),
    logout: vi.fn(async () => {}),
    whoAmI: vi.fn(async () => 'ana'),
    keyInfo: vi.fn(async () => key),
    generateKey: vi.fn(async () => key),
    importKey: vi.fn(async () => key),
    sign: vi.fn(async () => 'signature'),
    oauthSignIn: vi.fn(async (provider: string) => ({
      username: `${provider}-user`,
      token: 'oauth-token',
    })),
    loadCredentials: vi.fn(async () => null),
    storeCredentials: vi.fn(async () => {}),
    clearCredentials: vi.fn(async () => {}),
    loadDisplayName: vi.fn(() => stored),
    storeDisplayName: vi.fn((name: string) => void (stored = name)),
    copyText: vi.fn(async () => {}),
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

describe('signIn', () => {
  beforeEach(() => useAccount.getState().go({ tag: 'signedOut', error: null }))

  it('signs a challenge with this machine’s key, stores the session and trims the username', async () => {
    const { intents, repository } = setup()
    expect(await intents.signIn('  ana ')).toBeNull()
    expect(repository.sign).toHaveBeenCalledWith({ purpose: 'login', nonce: 'nonce-1' })
    expect(repository.login).toHaveBeenCalledWith({
      username: 'ana',
      nonce: 'nonce-1',
      signature: 'signature',
    })
    expect(repository.storeCredentials).toHaveBeenCalledWith({ username: 'ana', token: 'tok' })
    expect(state()).toEqual({ tag: 'signedIn', username: 'ana', token: 'tok' })
  })

  it('asks for a key first when this machine has none', async () => {
    const { intents, repository } = setup(fakeRepository({ keyInfo: async () => null }))
    expect(await intents.signIn('ana')).toContain('no key')
    expect(repository.challenge).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ tag: 'signedOut', error: expect.stringContaining('no key') })
  })

  it('shows the server error', async () => {
    const { intents } = setup(
      fakeRepository({
        login: async () => {
          throw new ApiError(401, 'No key of that account signed this request.')
        },
      }),
    )
    expect(await intents.signIn('ana')).toBe('No key of that account signed this request.')
    expect(state()).toEqual({
      tag: 'signedOut',
      error: 'No key of that account signed this request.',
    })
  })

  it('strips the noise Electron adds to errors thrown in main', async () => {
    const { intents } = setup(
      fakeRepository({
        sign: async () => {
          throw new Error("Error invoking remote method 'keys:sign': Error: Choose a server first.")
        },
      }),
    )
    expect(await intents.signIn('ana')).toBe('Choose a server first.')
  })

  it('refuses an empty username without asking the server', async () => {
    const { intents, repository } = setup()
    await intents.signIn(' ')
    expect(repository.challenge).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ tag: 'signedOut', error: expect.any(String) })
  })

  it('signs out and forgets the session', async () => {
    const { intents, repository } = setup()
    await intents.signIn('ana')
    await intents.signOut()
    expect(state()).toEqual({ tag: 'signedOut', error: null })
    expect(repository.logout).toHaveBeenCalledWith('tok')
    expect(repository.clearCredentials).toHaveBeenCalled()
  })
})

describe('register', () => {
  beforeEach(() => useAccount.getState().go({ tag: 'signedOut', error: null }))

  it('proves it holds the key by signing the challenge for that username', async () => {
    const { intents, repository } = setup()
    expect(await intents.register(' Bo ')).toBeNull()
    expect(repository.sign).toHaveBeenCalledWith({
      purpose: 'register',
      nonce: 'nonce-1',
      username: 'bo',
    })
    expect(repository.register).toHaveBeenCalledWith({
      username: 'Bo',
      publicKey: key.publicKey,
      nonce: 'nonce-1',
      signature: 'signature',
    })
    expect(repository.generateKey).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ tag: 'signedIn', token: 'new-token' })
  })

  it('creates this machine’s key when it has none', async () => {
    const { intents, repository } = setup(fakeRepository({ keyInfo: async () => null }))
    await intents.register('bo')
    expect(repository.generateKey).toHaveBeenCalled()
    expect(state().tag).toBe('signedIn')
  })

  it('reports a taken username', async () => {
    const { intents } = setup(
      fakeRepository({
        register: async () => {
          throw new ApiError(409, 'That username is taken.')
        },
      }),
    )
    expect(await intents.register('ana')).toBe('That username is taken.')
    expect(state()).toEqual({ tag: 'signedOut', error: 'That username is taken.' })
  })
})

describe('signInWithProvider', () => {
  beforeEach(() => useAccount.getState().go({ tag: 'signedOut', error: null }))

  it('signs in through the system browser', async () => {
    const { intents, repository } = setup()
    expect(await intents.signInWithProvider('github')).toBeNull()
    expect(repository.oauthSignIn).toHaveBeenCalledWith('github')
    expect(repository.storeCredentials).toHaveBeenCalledWith({
      username: 'github-user',
      token: 'oauth-token',
    })
    expect(state()).toEqual({ tag: 'signedIn', username: 'github-user', token: 'oauth-token' })
  })

  it('shows the provider’s refusal and goes back to signed out', async () => {
    const { intents } = setup(
      fakeRepository({
        oauthSignIn: async () => {
          throw new Error('The provider did not allow the sign-in.')
        },
      }),
    )
    expect(await intents.signInWithProvider('github')).toBe(
      'The provider did not allow the sign-in.',
    )
    expect(state()).toMatchObject({
      tag: 'signedOut',
      error: 'The provider did not allow the sign-in.',
    })
  })

  it('shows signing in while the browser is open, and does not start twice', async () => {
    let finish!: () => void
    const { intents } = setup(
      fakeRepository({
        oauthSignIn: () =>
          new Promise((resolve) => (finish = () => resolve({ username: 'a', token: 't' }))),
      }),
    )
    const pending = intents.signInWithProvider('github')
    expect(state().tag).toBe('signingIn')
    expect(await intents.signInWithProvider('github')).toBe('Already signing in.')
    finish()
    await pending
    expect(state().tag).toBe('signedIn')
  })
})

describe('open instances', () => {
  const open = { auth: 'none' as const, oauth: [], version: '1' }
  const accounts = { auth: 'accounts' as const, oauth: [], version: '1' }

  it('has no accounts: only a display name, remembered on this machine', () => {
    const { intents, repository } = setup()
    useAccount.getState().go({ tag: 'signedOut', error: null })
    intents.applyInstance(open)
    expect(state()).toEqual({ tag: 'anonymous', name: null })
    expect(intents.setDisplayName('  Ana  ')).toBeNull()
    expect(repository.storeDisplayName).toHaveBeenCalledWith('Ana')
    expect(state()).toEqual({ tag: 'anonymous', name: 'Ana' })

    // The next time (and the next server answer) the name is there already.
    useAccount.setState(useAccount.getInitialState(), true)
    intents.applyInstance(open)
    expect(state()).toEqual({ tag: 'anonymous', name: 'Ana' })
  })

  it('validates the display name', () => {
    const { intents } = setup()
    useAccount.getState().go({ tag: 'signedOut', error: null })
    expect(intents.setDisplayName('x')).toContain('has accounts') // not anonymous yet
    intents.applyInstance(open)
    expect(intents.setDisplayName('   ')).toBe('Enter a name.')
    expect(intents.setDisplayName('x'.repeat(33))).toContain('at most 32')
  })

  it('takes over from a saved session when the server turns out to be open', async () => {
    const { intents } = setup(
      fakeRepository({ loadCredentials: async () => ({ username: 'ana', token: 't' }) }),
    )
    await intents.restore()
    expect(state().tag).toBe('signedIn')
    intents.applyInstance(open)
    expect(state().tag).toBe('anonymous')
  })

  it('does not let a late restore overwrite what the server said', async () => {
    let release!: () => void
    const { intents } = setup(
      fakeRepository({
        loadCredentials: () =>
          new Promise((resolve) => (release = () => resolve({ username: 'ana', token: 't' }))),
      }),
    )
    const restoring = intents.restore()
    intents.applyInstance(open)
    release()
    await restoring
    expect(state()).toEqual({ tag: 'anonymous', name: null })
  })

  it('returns to the sign-in when the next server has accounts', () => {
    const { intents } = setup()
    intents.applyInstance(open)
    intents.applyInstance(accounts)
    expect(state()).toEqual({ tag: 'signedOut', error: null })
    intents.applyInstance(accounts)
    expect(state().tag).toBe('signedOut')
  })
})

describe('the rest', () => {
  it('imports a key from another machine, or says why not', async () => {
    const { intents } = setup()
    expect(await intents.importKey()).toEqual({
      message: 'Key imported (SHA256:abc).',
      error: null,
    })
    const cancelled = setup(fakeRepository({ importKey: async () => null }))
    expect(await cancelled.intents.importKey()).toEqual({ message: null, error: null })
    const bad = setup(
      fakeRepository({
        importKey: async () => {
          throw new Error(
            "Error invoking remote method 'keys:import': Error: That is not an Ed25519 key.",
          )
        },
      }),
    )
    expect(await bad.intents.importKey()).toEqual({
      message: null,
      error: 'That is not an Ed25519 key.',
    })
  })

  it('copies this machine’s public key for another device’s account', async () => {
    const { intents, repository } = setup()
    expect(await intents.copyPublicKey()).toBeNull()
    expect(repository.copyText).toHaveBeenCalledWith(key.publicKey)
    const none = setup(fakeRepository({ keyInfo: async () => null }))
    expect(await none.intents.copyPublicKey()).toContain('no key')
  })

  it('forgets a deleted account’s session without asking the server', async () => {
    const { intents, repository } = setup()
    useAccount.getState().go({ tag: 'signedOut', error: null })
    await intents.signIn('ana')
    await intents.accountDeleted()
    expect(state()).toEqual({ tag: 'signedOut', error: null })
    expect(repository.logout).not.toHaveBeenCalled()
    expect(repository.clearCredentials).toHaveBeenCalled()
  })

  it('signs out when the server rejects the token', async () => {
    const { intents } = setup()
    useAccount.getState().go({ tag: 'signedOut', error: null })
    await intents.signIn('ana')
    await intents.sessionRejected()
    expect(state()).toMatchObject({ tag: 'signedOut', error: expect.stringContaining('expired') })
  })
})
