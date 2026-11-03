package dev.cowrite.server.kit

import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/** Ed25519 public keys and signatures, with the JDK's own provider (no dependency). */
object Ed25519 {
    class InvalidKey(
        message: String,
    ) : Exception(message)

    private const val MAX_PEM_CHARS = 4096
    private val PEM = Regex("-----BEGIN PUBLIC KEY-----(.*?)-----END PUBLIC KEY-----", RegexOption.DOT_MATCHES_ALL)

    /** The SPKI DER bytes of a public key given as PEM. Throws [InvalidKey] unless it is Ed25519. */
    fun parsePublicKey(text: String): ByteArray {
        if (text.length > MAX_PEM_CHARS) throw InvalidKey("That key is too long.")
        val body = PEM.find(text)?.groupValues?.get(1) ?: throw InvalidKey("Expected a PEM public key (BEGIN PUBLIC KEY).")
        val der =
            try {
                Base64.getMimeDecoder().decode(body.filterNot { it.isWhitespace() })
            } catch (e: IllegalArgumentException) {
                throw InvalidKey("That key is not valid base64.")
            }
        try {
            KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(der))
        } catch (e: GeneralSecurityException) {
            throw InvalidKey("That is not an Ed25519 public key.")
        }
        return der
    }

    /** True when `signature` is `publicKey`'s signature of `message`. Never throws. */
    fun verify(
        publicKey: ByteArray,
        message: ByteArray,
        signature: ByteArray,
    ): Boolean =
        signature.size == 64 &&
            try {
                val key = KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(publicKey))
                Signature.getInstance("Ed25519").run {
                    initVerify(key)
                    update(message)
                    verify(signature)
                }
            } catch (e: GeneralSecurityException) {
                false
            }

    /** `SHA256:<base64>` of the SPKI bytes, the way SSH shows key fingerprints. */
    fun fingerprint(publicKey: ByteArray): String =
        "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(publicKey))
}
