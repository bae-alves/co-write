import type {
  AuthResponse,
  ChallengeResponse,
  Credentials,
  KeyInfo,
  LoginRequest,
  RegisterRequest,
  SigningInput,
} from '@co-write/shared'
import { apiRequest, desktopApi } from '@/server/repository'

export interface AccountRepository {
  /** A fresh single-use nonce to sign. */
  challenge(): Promise<ChallengeResponse>
  register(request: RegisterRequest): Promise<AuthResponse>
  login(request: LoginRequest): Promise<AuthResponse>
  logout(token: string): Promise<void>
  /** Checks a stored token is still accepted; resolves to the username it belongs to. */
  whoAmI(token: string): Promise<string>
  /** This machine's key (public half only), or null when it has none. */
  keyInfo(): Promise<KeyInfo | null>
  generateKey(): Promise<KeyInfo>
  /** Asks for a key file (exported from another machine) and adopts it; null if cancelled. */
  importKey(): Promise<KeyInfo | null>
  /** Main signs the text for the configured server; the key never reaches the renderer. */
  sign(input: SigningInput): Promise<string>
  /** Opens the system browser for an OAuth sign-in; resolves with the session. */
  oauthSignIn(provider: string): Promise<Credentials>
  loadCredentials(): Promise<Credentials | null>
  storeCredentials(credentials: Credentials): Promise<void>
  clearCredentials(): Promise<void>
  /** The name shown on your cursor on an open instance (a per-machine preference). */
  loadDisplayName(): string | null
  storeDisplayName(name: string): void
  copyText(text: string): Promise<void>
}

const NAME_KEY = 'co-write.display-name'

function requireApi() {
  const api = desktopApi()
  if (!api) throw new Error('This needs the desktop app')
  return api
}

export function createAccountRepository(storage: Storage | undefined): AccountRepository {
  const api = desktopApi
  return {
    challenge: () => apiRequest('/api/auth/challenge', { method: 'POST', body: {} }),
    register: (body) => apiRequest('/api/auth/register', { method: 'POST', body }),
    login: (body) => apiRequest('/api/auth/login', { method: 'POST', body }),
    logout: (token) => apiRequest('/api/auth/logout', { method: 'POST', token }),
    whoAmI: async (token) =>
      (await apiRequest<{ username: string }>('/api/auth/me', { token })).username,
    keyInfo: async () => (await api()?.keyInfo()) ?? null,
    generateKey: () => requireApi().generateKey(false),
    importKey: () => requireApi().importKey(),
    sign: (input) => requireApi().signWithKey(input),
    oauthSignIn: (provider) => requireApi().oauthSignIn({ provider }),
    loadCredentials: async () => (await api()?.loadCredentials()) ?? null,
    storeCredentials: async (credentials) => api()?.storeCredentials(credentials),
    clearCredentials: async () => api()?.clearCredentials(),
    loadDisplayName() {
      try {
        return storage?.getItem(NAME_KEY) || null
      } catch {
        return null
      }
    },
    storeDisplayName(name) {
      try {
        storage?.setItem(NAME_KEY, name)
      } catch {
        // A display name is a convenience; losing it is fine.
      }
    },
    copyText: (text) => navigator.clipboard.writeText(text),
  }
}

export const accountRepository = createAccountRepository(
  typeof localStorage === 'undefined' ? undefined : localStorage,
)
