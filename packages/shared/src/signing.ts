/**
 * The exact texts a desktop signs to register or sign in, and how a server address becomes the
 * origin they contain. Each text names its purpose, the server it is for and a fresh single-use
 * nonce, so a signature cannot be replayed against another server or reused for another purpose.
 * The Ktor server builds the same texts in `kit/SignedMessages.kt`; both are checked against
 * `apps/server/src/test/resources/ed25519-fixtures.json`.
 */

export type SigningRequest =
  | { readonly purpose: 'login'; readonly origin: string; readonly nonce: string }
  | {
      readonly purpose: 'register'
      readonly origin: string
      readonly nonce: string
      readonly username: string
    }

export function signedMessage(request: SigningRequest): string {
  const { purpose, origin, nonce } = request
  return request.purpose === 'register'
    ? `co-write-${purpose}\n${origin}\n${nonce}\n${request.username}`
    : `co-write-${purpose}\n${origin}\n${nonce}`
}

/** `scheme://host[:port]` of an http(s) server address, lower-case, default port dropped; null otherwise. */
export function normalizeOrigin(address: string): string | null {
  try {
    const url = new URL(address.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}
