import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccount } from '@/features/account/model'
import { createSecurityIntents } from './intent'
import { useSecurity } from './model'
import type { SecurityRepository } from './repository'

const localKey = { publicKey: 'PEM', fingerprint: 'SHA256:local', protected: true }
const laptop = { id: 1, fingerprint: 'SHA256:laptop', label: 'laptop', createdAt: 1 }
const desktop = { id: 2, fingerprint: 'SHA256:desktop', label: 'desktop', createdAt: 2 }

function setup(
  overrides: Partial<SecurityRepository> = {},
  deleteAccount = async () => null as string | null,
  transferOwnership = vi.fn(async () => null as string | null),
) {
  const repository: SecurityRepository = {
    keys: vi.fn(async () => [laptop]),
    addKey: vi.fn(async () => desktop),
    removeKey: vi.fn(async () => {}),
    identities: vi.fn(async () => []),
    linkIntent: vi.fn(async () => 'intent-1'),
    unlinkProvider: vi.fn(async () => {}),
    linkProvider: vi.fn(async () => {}),
    localKey: vi.fn(async () => localKey),
    createLocalKey: vi.fn(async () => localKey),
    importLocalKey: vi.fn(async () => localKey),
    exportLocalKey: vi.fn(async () => true),
    copyText: vi.fn(async () => {}),
    ...overrides,
  }
  const accountDeleted = vi.fn(async () => {})
  const intents = createSecurityIntents({
    model: useSecurity,
    repository,
    account: useAccount,
    deleteAccount,
    transferOwnership,
    accountDeleted,
  })
  return { intents, repository, accountDeleted, transferOwnership }
}

const state = () => useSecurity.getState().state

beforeEach(() => {
  useSecurity.setState(useSecurity.getInitialState(), true)
  useAccount.setState(useAccount.getInitialState(), true)
  useAccount.getState().go({ tag: 'signedOut', error: null })
  useAccount.getState().go({ tag: 'signingIn', username: 'ana' })
  useAccount.getState().go({ tag: 'signedIn', username: 'ana', token: 'tok' })
})

describe('security', () => {
  it('loads the account’s keys and linked providers, and this machine’s key', async () => {
    const { intents, repository } = setup({
      identities: async () => [{ provider: 'github', login: 'octo' }],
    })
    await intents.open()
    expect(repository.keys).toHaveBeenCalledWith('tok')
    expect(state()).toEqual({
      tag: 'ready',
      keys: [laptop],
      identities: [{ provider: 'github', login: 'octo' }],
      local: localKey,
      busy: false,
      error: null,
      notice: null,
    })
  })

  it('does nothing without a signed-in account', async () => {
    useAccount.setState(useAccount.getInitialState(), true)
    useAccount.getState().go({ tag: 'signedOut', error: null })
    await setup().intents.open()
    expect(state()).toEqual({ tag: 'closed' })
  })

  it('shows what could not be loaded without losing the rest', async () => {
    const { intents } = setup({
      keys: async () => {
        throw new Error('Server unreachable')
      },
    })
    await intents.open()
    expect(state()).toMatchObject({
      tag: 'ready',
      keys: [],
      local: localKey,
      error: 'Server unreachable',
    })
  })

  it('adds another device’s key, then reloads', async () => {
    const { intents, repository } = setup()
    await intents.open()
    vi.mocked(repository.keys).mockResolvedValue([laptop, desktop])
    await intents.addKey('  PEM  ', ' desktop ')
    expect(repository.addKey).toHaveBeenCalledWith('tok', { publicKey: 'PEM', label: 'desktop' })
    expect(state()).toMatchObject({
      keys: [laptop, desktop],
      notice: expect.stringContaining('Key added'),
      error: null,
    })
  })

  it('shows why a key was refused', async () => {
    const { intents } = setup({
      addKey: async () => {
        throw new Error('That is not an Ed25519 public key.')
      },
    })
    await intents.open()
    await intents.addKey('junk', '')
    expect(state()).toMatchObject({ error: 'That is not an Ed25519 public key.', notice: null })
    await intents.addKey('  ', '')
    expect(state()).toMatchObject({ error: expect.stringContaining('Paste') })
  })

  it('removes a key', async () => {
    const { intents, repository } = setup()
    await intents.open()
    await intents.removeKey(2)
    expect(repository.removeKey).toHaveBeenCalledWith('tok', 2)
    expect(state()).toMatchObject({ notice: expect.stringContaining('Key removed') })
  })

  it('shows the server’s refusal to remove the last way to sign in', async () => {
    const { intents } = setup({
      removeKey: async () => {
        throw new Error('That is your only way to sign in.')
      },
    })
    await intents.open()
    await intents.removeKey(1)
    expect(state()).toMatchObject({ error: 'That is your only way to sign in.' })
  })

  it('links a provider with a one-time intent, and unlinks it', async () => {
    const { intents, repository } = setup()
    await intents.open()
    await intents.linkProvider('github')
    expect(repository.linkIntent).toHaveBeenCalledWith('tok')
    expect(repository.linkProvider).toHaveBeenCalledWith({
      provider: 'github',
      linkIntent: 'intent-1',
    })
    await intents.unlinkProvider('github')
    expect(repository.unlinkProvider).toHaveBeenCalledWith('tok', 'github')
  })

  it('manages this machine’s key: create, import, export, copy', async () => {
    const { intents, repository } = setup()
    await intents.open()
    await intents.createLocalKey()
    await intents.importLocalKey()
    await intents.exportLocalKey()
    await intents.copyLocalPublicKey()
    expect(repository.createLocalKey).toHaveBeenCalled()
    expect(repository.copyText).toHaveBeenCalledWith('PEM')
    expect(state()).toMatchObject({ notice: 'Public key copied.' })
  })

  it('says nothing when the user cancels a file dialog', async () => {
    const { intents } = setup({
      importLocalKey: async () => null,
      exportLocalKey: async () => false,
    })
    await intents.open()
    await intents.importLocalKey()
    expect(state()).toMatchObject({ notice: null, error: null })
    await intents.exportLocalKey()
    expect(state()).toMatchObject({ notice: null, error: null })
  })

  it('deletes the account only when the username is typed out', async () => {
    const deleteAccount = vi.fn(async () => null as string | null)
    const { intents, accountDeleted } = setup({}, deleteAccount)
    await intents.open()
    await intents.deleteAccount('nope')
    expect(deleteAccount).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ error: expect.stringContaining('ana') })

    // The account is gone afterwards: the sign-out empties the dialog.
    deleteAccount.mockImplementation(async () => {
      useAccount.getState().go({ tag: 'signedOut', error: null })
      return null
    })
    await intents.deleteAccount(' ANA ')
    expect(deleteAccount).toHaveBeenCalled()
    expect(accountDeleted).toHaveBeenCalled()
    expect(state()).toEqual({ tag: 'closed' })
  })

  it('keeps the account when the server refuses to delete it', async () => {
    const { intents, accountDeleted } = setup({}, async () => 'Server unreachable')
    await intents.open()
    await intents.deleteAccount('ana')
    expect(accountDeleted).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ tag: 'ready', error: 'Server unreachable' })
  })

  it('ignores a second action while one is running', async () => {
    let finish!: () => void
    const { intents, repository } = setup({
      removeKey: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    })
    await intents.open()
    const first = intents.removeKey(1)
    await intents.removeKey(2)
    expect(repository.removeKey).toHaveBeenCalledTimes(1)
    finish()
    await first
  })

  it('hands a document to someone else before the account goes', async () => {
    const { intents, transferOwnership } = setup()
    await intents.open()
    await intents.transferOwnership('d1', ' bo ')
    expect(transferOwnership).toHaveBeenCalledWith('d1', ' bo ')
    expect(state()).toMatchObject({ notice: 'Handed the document to bo.', error: null })

    transferOwnership.mockResolvedValueOnce('No user with that name.')
    await intents.transferOwnership('d1', 'nobody')
    expect(state()).toMatchObject({ error: 'No user with that name.' })
  })

  it('closes', async () => {
    const { intents } = setup()
    await intents.open()
    intents.close()
    expect(state()).toEqual({ tag: 'closed' })
  })
})
