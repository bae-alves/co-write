package dev.cowrite.server.kit

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** Password hashing, token generation and token hashing. Pure computation, JDK only. */
object Secrets {
    private val random = SecureRandom()
    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private val decoder = Base64.getUrlDecoder()

    private const val ALGORITHM = "PBKDF2WithHmacSHA256"
    private const val ITERATIONS = 210_000 // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
    private const val KEY_BITS = 256

    fun randomId(bytes: Int): String = encoder.encodeToString(ByteArray(bytes).also(random::nextBytes))

    /** `pbkdf2-sha256$<iterations>$<salt>$<hash>`, all base64url. */
    fun hashPassword(
        password: String,
        iterations: Int = ITERATIONS,
    ): String {
        val salt = ByteArray(16).also(random::nextBytes)
        val hash = pbkdf2(password, salt, iterations)
        return "pbkdf2-sha256$$iterations$${encoder.encodeToString(salt)}$${encoder.encodeToString(hash)}"
    }

    fun verifyPassword(
        password: String,
        stored: String,
    ): Boolean {
        val parts = stored.split('$')
        if (parts.size != 4 || parts[0] != "pbkdf2-sha256") return false
        val iterations = parts[1].toIntOrNull() ?: return false
        val expected = runCatching { decoder.decode(parts[3]) }.getOrNull() ?: return false
        val salt = runCatching { decoder.decode(parts[2]) }.getOrNull() ?: return false
        return MessageDigest.isEqual(expected, pbkdf2(password, salt, iterations))
    }

    /** Session tokens are stored hashed, so a database leak does not leak live sessions. */
    fun hashToken(token: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(token.encodeToByteArray())

    private fun pbkdf2(
        password: String,
        salt: ByteArray,
        iterations: Int,
    ): ByteArray {
        val spec = PBEKeySpec(password.toCharArray(), salt, iterations, KEY_BITS)
        try {
            return SecretKeyFactory.getInstance(ALGORITHM).generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }
}
