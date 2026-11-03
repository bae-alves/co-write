import type { DocumentSummary, MemberRequest } from '@co-write/shared'
import { apiRequest, serverUrl } from '@/server/repository'

export interface SharedDocsRepository {
  list(token: string): Promise<DocumentSummary[]>
  /** The last list fetched for `username`, so shared documents stay reachable offline. */
  cachedList(username: string): DocumentSummary[]
  cacheList(username: string, docs: readonly DocumentSummary[]): void
  create(token: string, title: string): Promise<DocumentSummary>
  addMember(token: string, docId: string, member: MemberRequest): Promise<void>
  removeMember(token: string, docId: string, username: string): Promise<void>
  transferOwner(token: string, docId: string, username: string): Promise<void>
  /** Deletes the signed-in account with its keys, sessions, memberships and the documents it owns. */
  deleteAccount(token: string): Promise<void>
}

// Per server too: the same name on two servers is two different people.
const cacheKey = (username: string) => `co-write.shared-docs.${serverUrl() ?? ''}.${username}`

export const sharedDocsRepository: SharedDocsRepository = {
  list: (token) => apiRequest('/api/docs', { token }),
  cachedList(username) {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(cacheKey(username)) ?? '[]')
      return Array.isArray(value) ? (value as DocumentSummary[]) : []
    } catch {
      return []
    }
  },
  cacheList(username, docs) {
    try {
      localStorage.setItem(cacheKey(username), JSON.stringify(docs))
    } catch {
      // A cache; losing it only matters offline.
    }
  },
  create: (token, title) => apiRequest('/api/docs', { method: 'POST', token, body: { title } }),
  addMember: (token, docId, member) =>
    apiRequest(`/api/docs/${encodeURIComponent(docId)}/members`, {
      method: 'PUT',
      token,
      body: member,
    }),
  removeMember: (token, docId, username) =>
    apiRequest(`/api/docs/${encodeURIComponent(docId)}/members/${encodeURIComponent(username)}`, {
      method: 'DELETE',
      token,
    }),
  transferOwner: (token, docId, username) =>
    apiRequest(`/api/docs/${encodeURIComponent(docId)}/owner`, {
      method: 'PUT',
      token,
      body: { username },
    }),
  deleteAccount: (token) => apiRequest('/api/me', { method: 'DELETE', token }),
}
