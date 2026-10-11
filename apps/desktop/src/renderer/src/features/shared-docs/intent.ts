import type { DocumentSummary, MemberRequest, Role } from '@co-write/shared'
import { accountIntents } from '@/features/account/intent'
import { useAccount } from '@/features/account/model'
import { documentIntents } from '@/features/document/intent'
import { isRemoteOpen, useDocument } from '@/features/document/model'
import { workbenchIntents } from '@/features/workbench/intent'
import { ApiError } from '@/server/repository'
import { useSharedDocs, type SharedDocs } from './model'
import { sharedDocsRepository, type SharedDocsRepository } from './repository'

export interface SharedDocsDeps {
  readonly model: typeof useSharedDocs
  readonly repository: SharedDocsRepository
  readonly account: typeof useAccount
  readonly document: typeof useDocument
  readonly documents: {
    openRemote(docId: string, title: string, role: Role, seed?: string): Promise<void>
    text(): string | null
    close(): Promise<void>
  }
  readonly sessionRejected: () => void
  readonly revealSource: () => void
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function createSharedDocsIntents(deps: SharedDocsDeps) {
  const { model, repository } = deps
  const go = (next: SharedDocs) => model.getState().go(next)
  const docsNow = () => {
    const now = model.getState().state
    return now.tag === 'hidden' ? [] : now.docs
  }
  const token = (): string | null => {
    const account = deps.account.getState().state
    return account.tag === 'signedIn' ? account.token : null
  }
  const username = (): string | null => {
    const account = deps.account.getState().state
    return account.tag === 'signedIn' ? account.username : null
  }

  /** Runs a server call; a 401 signs the user out. Returns the error message on failure. */
  async function call<T>(
    run: (token: string) => Promise<T>,
  ): Promise<{ ok: T } | { error: string }> {
    const current = token()
    if (!current) return { error: 'Sign in first.' }
    try {
      return { ok: await run(current) }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) deps.sessionRejected()
      return { error: message(error) }
    }
  }

  async function openSummary(doc: DocumentSummary, seed?: string): Promise<void> {
    deps.revealSource()
    await deps.documents.openRemote(doc.id, doc.title, doc.role, seed)
  }

  return {
    async refresh(): Promise<void> {
      if (!token()) {
        if (model.getState().state.tag !== 'hidden') go({ tag: 'hidden' })
        return
      }
      if (model.getState().state.tag === 'loading') return
      const user = username()!
      const known = docsNow()
      go({ tag: 'loading', docs: known.length > 0 ? known : repository.cachedList(user) })
      const result = await call((t) => repository.list(t))
      if (model.getState().state.tag !== 'loading') return // signed out meanwhile
      if ('ok' in result) {
        const docs = [...result.ok].sort((a, b) => b.updatedAt - a.updatedAt)
        repository.cacheList(user, docs)
        go({ tag: 'ready', docs })
      } else go({ tag: 'failed', docs: docsNow(), reason: result.error })
    },

    open: openSummary,

    /** Creates an empty shared document and opens it. Returns an error message, or null. */
    async create(title: string): Promise<string | null> {
      const name = title.trim()
      if (!name) return 'Give the document a title.'
      const result = await call((t) => repository.create(t, name))
      if ('error' in result) return result.error
      await openSummary(result.ok)
      void this.refresh()
      return null
    },

    /** Copies the open local file to the server as a new shared document, and switches to it. */
    async publish(): Promise<string | null> {
      const document = deps.document.getState().state
      const text = deps.documents.text()
      if (document.tag !== 'local' || text === null) return 'Open a local file to share it.'
      const title = document.title.replace(/\.(md|markdown|mdown|mkd)$/i, '')
      const result = await call((t) => repository.create(t, title))
      if ('error' in result) return result.error
      await openSummary(result.ok, text)
      void this.refresh()
      return null
    },

    /** Gives `username` access to the open shared document. Returns an error message, or null. */
    async invite(username: string, role: MemberRequest['role']): Promise<string | null> {
      const document = deps.document.getState().state
      if (!isRemoteOpen(document)) return 'Open a shared document first.'
      if (document.role !== 'owner') return 'Only the owner can share this document.'
      const name = username.trim()
      if (!name) return 'Enter a username.'
      const result = await call((t) =>
        repository.addMember(t, document.ref.docId, { username: name, role }),
      )
      return 'error' in result ? result.error : null
    },

    /** Follows the account: load the list on sign-in; hide it and close shared docs on sign-out. */
    listen(): () => void {
      return deps.account.subscribe((next, previous) => {
        if (next.state.tag === previous.state.tag) return
        if (next.state.tag === 'signedIn') void this.refresh()
        if (next.state.tag === 'signedOut') {
          if (model.getState().state.tag !== 'hidden') go({ tag: 'hidden' })
          if (isRemoteOpen(deps.document.getState().state)) void deps.documents.close()
        }
      })
    },
  }
}

export const sharedDocsIntents = createSharedDocsIntents({
  model: useSharedDocs,
  repository: sharedDocsRepository,
  account: useAccount,
  document: useDocument,
  documents: documentIntents,
  sessionRejected: () => void accountIntents.sessionRejected(),
  revealSource: () => workbenchIntents.reveal('source'),
})
