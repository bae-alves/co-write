import type { DocumentSummary, MemberRequest } from '@co-write/shared'
import { apiRequest } from '@/server/repository'

export interface SharedDocsRepository {
  list(token: string): Promise<DocumentSummary[]>
  /** The last list fetched for `username`, so shared documents stay reachable offline. */
  cachedList(username: string): DocumentSummary[]
  cacheList(username: string, docs: readonly DocumentSummary[]): void
  create(token: string, title: string): Promise<DocumentSummary>
  addMember(token: string, docId: string, member: MemberRequest): Promise<void>
}

const cacheKey = (username: string) => `co-write.shared-docs.${username}`

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
}
