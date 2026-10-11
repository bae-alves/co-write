import type { AuthRequest, AuthResponse, Credentials } from '@co-write/shared'
import { apiRequest, desktopApi } from '@/server/repository'

export interface AccountRepository {
  register(request: AuthRequest): Promise<AuthResponse>
  login(request: AuthRequest): Promise<AuthResponse>
  logout(token: string): Promise<void>
  /** Checks a stored token is still accepted; resolves to the username it belongs to. */
  whoAmI(token: string): Promise<string>
  loadCredentials(): Promise<Credentials | null>
  storeCredentials(credentials: Credentials): Promise<void>
  clearCredentials(): Promise<void>
}

export function createAccountRepository(): AccountRepository {
  const api = desktopApi
  return {
    register: (body) => apiRequest('/api/auth/register', { method: 'POST', body }),
    login: (body) => apiRequest('/api/auth/login', { method: 'POST', body }),
    logout: (token) => apiRequest('/api/auth/logout', { method: 'POST', token }),
    whoAmI: async (token) =>
      (await apiRequest<{ username: string }>('/api/auth/me', { token })).username,
    loadCredentials: async () => (await api()?.loadCredentials()) ?? null,
    storeCredentials: async (credentials) => api()?.storeCredentials(credentials),
    clearCredentials: async () => api()?.clearCredentials(),
  }
}

export const accountRepository = createAccountRepository()
