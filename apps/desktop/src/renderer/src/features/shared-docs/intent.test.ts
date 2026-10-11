import type { DocumentSummary } from '@co-write/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccount } from '@/features/account/model'
import { useDocument } from '@/features/document/model'
import { ApiError } from '@/server/repository'
import { createSharedDocsIntents } from './intent'
import { useSharedDocs } from './model'
import type { SharedDocsRepository } from './repository'

const doc = (id: string, updatedAt: number, role: DocumentSummary['role'] = 'owner') => ({
  id,
  title: `Doc ${id}`,
  owner: 'ana',
  role,
  updatedAt,
})

function setup(overrides: Partial<SharedDocsRepository> = {}) {
  const repository: SharedDocsRepository = {
    list: vi.fn(async () => [doc('a', 1), doc('b', 2)]),
    create: vi.fn(async (_t, title) => ({ ...doc('new', 3), title })),
    addMember: vi.fn(async () => {}),
    cachedList: vi.fn(() => []),
    cacheList: vi.fn(),
    ...overrides,
  }
  const documents = {
    openRemote: vi.fn(async () => {}),
    text: vi.fn(() => '# local text'),
    close: vi.fn(async () => {}),
  }
  const sessionRejected = vi.fn()
  const intents = createSharedDocsIntents({
    model: useSharedDocs,
    repository,
    account: useAccount,
    document: useDocument,
    documents,
    sessionRejected,
    revealSource: () => {},
  })
  return { intents, repository, documents, sessionRejected }
}

const state = () => useSharedDocs.getState().state
const signIn = () => {
  useAccount.getState().go({ tag: 'signedOut', error: null })
  useAccount.getState().go({ tag: 'signingIn', username: 'ana' })
  useAccount.getState().go({ tag: 'signedIn', username: 'ana', token: 'tok' })
}

beforeEach(() => {
  useSharedDocs.setState(useSharedDocs.getInitialState(), true)
  useAccount.setState(useAccount.getInitialState(), true)
  useDocument.setState(useDocument.getInitialState(), true)
})

describe('shared docs', () => {
  it('stays hidden while signed out', async () => {
    const { intents, repository } = setup()
    await intents.refresh()
    expect(state()).toEqual({ tag: 'hidden' })
    expect(repository.list).not.toHaveBeenCalled()
  })

  it('lists documents, most recently updated first', async () => {
    signIn()
    const { intents, repository } = setup()
    await intents.refresh()
    expect(repository.list).toHaveBeenCalledWith('tok')
    expect(state()).toMatchObject({ tag: 'ready', docs: [{ id: 'b' }, { id: 'a' }] })
  })

  it('keeps the last list when a refresh fails', async () => {
    signIn()
    const { intents, repository } = setup()
    await intents.refresh()
    vi.mocked(repository.list).mockRejectedValueOnce(new ApiError(0, 'Server unreachable'))
    await intents.refresh()
    expect(state()).toMatchObject({ tag: 'failed', reason: 'Server unreachable', docs: [{}, {}] })
  })

  it('falls back to the cached list when the server is unreachable', async () => {
    signIn()
    const { intents, repository } = setup({
      list: async () => {
        throw new ApiError(0, 'Server unreachable')
      },
      cachedList: vi.fn(() => [doc('cached', 1)]),
    })
    await intents.refresh()
    expect(repository.cachedList).toHaveBeenCalledWith('ana')
    expect(state()).toMatchObject({ tag: 'failed', docs: [{ id: 'cached' }] })
  })

  it('caches every list it fetches', async () => {
    signIn()
    const { intents, repository } = setup()
    await intents.refresh()
    expect(repository.cacheList).toHaveBeenCalledWith('ana', [doc('b', 2), doc('a', 1)])
  })

  it('signs out on a rejected token', async () => {
    signIn()
    const { intents, sessionRejected } = setup({
      list: async () => {
        throw new ApiError(401, 'Unauthorized')
      },
    })
    await intents.refresh()
    expect(sessionRejected).toHaveBeenCalled()
  })

  it('creates and opens a document', async () => {
    signIn()
    const { intents, documents } = setup()
    expect(await intents.create('  Plan ')).toBeNull()
    expect(documents.openRemote).toHaveBeenCalledWith('new', 'Plan', 'owner', undefined)
    expect(await intents.create(' ')).toBe('Give the document a title.')
  })

  it('publishes the open local file with its content as seed', async () => {
    signIn()
    useDocument
      .getState()
      .go({ tag: 'loading', ref: { kind: 'local', path: 'n/plan.md' }, title: 'plan.md' })
    useDocument.getState().go({
      tag: 'local',
      session: 1,
      ref: { kind: 'local', path: 'n/plan.md' },
      title: 'plan.md',
      dirty: false,
      saving: false,
      diskChanged: false,
      saveError: null,
    })
    const { intents, repository, documents } = setup()
    expect(await intents.publish()).toBeNull()
    expect(repository.create).toHaveBeenCalledWith('tok', 'plan')
    expect(documents.openRemote).toHaveBeenCalledWith('new', 'plan', 'owner', '# local text')
  })

  it('invites collaborators only as owner of the open document', async () => {
    signIn()
    const { intents, repository } = setup()
    expect(await intents.invite('bo', 'editor')).toBe('Open a shared document first.')
    const ref = { kind: 'remote' as const, docId: 'd1' }
    useDocument.getState().go({ tag: 'loading', ref, title: 'D' })
    useDocument
      .getState()
      .go({ tag: 'connecting', session: 1, ref, title: 'D', role: 'owner', peers: [] })
    expect(await intents.invite(' bo ', 'viewer')).toBeNull()
    expect(repository.addMember).toHaveBeenCalledWith('tok', 'd1', {
      username: 'bo',
      role: 'viewer',
    })
  })

  it('follows sign-in and sign-out', async () => {
    const { intents, repository, documents } = setup()
    const stop = intents.listen()
    signIn()
    await vi.waitFor(() => expect(state().tag).toBe('ready'))
    expect(repository.list).toHaveBeenCalled()
    const ref = { kind: 'remote' as const, docId: 'd1' }
    useDocument.getState().go({ tag: 'loading', ref, title: 'D' })
    useDocument
      .getState()
      .go({ tag: 'connecting', session: 1, ref, title: 'D', role: 'owner', peers: [] })
    useAccount.getState().go({ tag: 'signedOut', error: null })
    expect(state()).toEqual({ tag: 'hidden' })
    expect(documents.close).toHaveBeenCalled()
    stop()
  })
})
