package dev.cowrite.server.kit

import java.security.MessageDigest
import java.util.Base64

/** PKCE (RFC 7636), S256 only. */
object Pkce {
    private val CHALLENGE = Regex("^[A-Za-z0-9_-]{43}$")
    private val VERIFIER = Regex("^[A-Za-z0-9._~-]{43,128}$")

    fun isChallenge(value: String): Boolean = CHALLENGE.matches(value)

    fun isVerifier(value: String): Boolean = VERIFIER.matches(value)

    fun challengeOf(verifier: String): String =
        Base64
            .getUrlEncoder()
            .withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.encodeToByteArray()))

    /** Compared in constant time. */
    fun matches(
        verifier: String,
        challenge: String,
    ): Boolean = isVerifier(verifier) && MessageDigest.isEqual(challengeOf(verifier).encodeToByteArray(), challenge.encodeToByteArray())
}
