package dev.cowrite.server.kit

import java.net.URI

/**
 * The exact texts clients sign. Each starts with its purpose and contains the server's origin and a
 * fresh single-use nonce, so a signature cannot be replayed against another server or reused for
 * another purpose. The desktop builds the same texts in `packages/shared/src/signing.ts`.
 */
object SignedMessages {
    fun login(
        origin: String,
        nonce: String,
    ): String = "co-write-login\n$origin\n$nonce"

    fun register(
        origin: String,
        nonce: String,
        username: String,
    ): String = "co-write-register\n$origin\n$nonce\n$username"

    /** `scheme://host[:port]`, lower-case, default port dropped, no path; null if it is no http(s) URL. */
    fun normalizeOrigin(url: String): String? {
        val uri = runCatching { URI(url.trim()) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase()
        val host = uri.host?.lowercase()
        if ((scheme != "http" && scheme != "https") || host == null) return null
        val port = uri.port.takeIf { it != -1 && !(it == 80 && scheme == "http") && !(it == 443 && scheme == "https") }
        return if (port == null) "$scheme://$host" else "$scheme://$host:$port"
    }
}
