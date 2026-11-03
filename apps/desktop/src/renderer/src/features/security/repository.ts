import type {
  AddKeyRequest,
  KeyInfo,
  KeySummary,
  LinkedIdentity,
  OAuthRequest,
} from '@co-write/shared'
import { apiRequest, desktopApi } from '@/server/repository'

export interface SecurityRepository {
  keys(token: string): Promise<KeySummary[]>
  addKey(token: string, request: AddKeyRequest): Promise<KeySummary>
  removeKey(token: string, id: number): Promise<void>
  identities(token: string): Promise<LinkedIdentity[]>
  /** A one-time proof that the signed-in user wants to link a provider. */
  linkIntent(token: string): Promise<string>
  unlinkProvider(token: string, provider: string): Promise<void>
  /** Links a provider through the system browser; resolves once the browser round-trip is done. */
  linkProvider(request: OAuthRequest): Promise<void>
  localKey(): Promise<KeyInfo | null>
  createLocalKey(): Promise<KeyInfo>
  /** Asks for a key file and adopts it; null when the user cancels. */
  importLocalKey(): Promise<KeyInfo | null>
  /** Asks where to save the private key; false when the user cancels. */
  exportLocalKey(): Promise<boolean>
  copyText(text: string): Promise<void>
}

function requireApi() {
  const api = desktopApi()
  if (!api) throw new Error('This needs the desktop app')
  return api
}

export const securityRepository: SecurityRepository = {
  keys: (token) => apiRequest('/api/me/keys', { token }),
  addKey: (token, body) => apiRequest('/api/me/keys', { method: 'POST', token, body }),
  removeKey: (token, id) => apiRequest(`/api/me/keys/${id}`, { method: 'DELETE', token }),
  identities: (token) => apiRequest('/api/me/oauth', { token }),
  linkIntent: async (token) =>
    (await apiRequest<{ intent: string }>('/api/me/oauth/link-intent', { method: 'POST', token }))
      .intent,
  unlinkProvider: (token, provider) =>
    apiRequest(`/api/me/oauth/${encodeURIComponent(provider)}`, { method: 'DELETE', token }),
  linkProvider: async (request) => void (await requireApi().oauthSignIn(request)),
  localKey: async () => (await desktopApi()?.keyInfo()) ?? null,
  createLocalKey: () => requireApi().generateKey(false),
  importLocalKey: () => requireApi().importKey(),
  exportLocalKey: () => requireApi().exportKey(),
  copyText: (text) => navigator.clipboard.writeText(text),
}
