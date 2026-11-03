package dev.cowrite.server.kit

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** Random identifiers and token hashing. Pure computation, JDK only. There are no passwords. */
object Secrets {
    private val random = SecureRandom()
    private val encoder = Base64.getUrlEncoder().withoutPadding()

    fun randomId(bytes: Int): String = encoder.encodeToString(ByteArray(bytes).also(random::nextBytes))

    /**
     * Session tokens, challenges, tickets and one-time codes are stored hashed, so a database leak
     * does not leak anything that can still be used.
     */
    fun hashToken(token: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(token.encodeToByteArray())
}
