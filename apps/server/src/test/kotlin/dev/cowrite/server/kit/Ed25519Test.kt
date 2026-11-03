package dev.cowrite.server.kit

import dev.cowrite.server.features.auth.TestKey
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class Ed25519Test {
    private val decoder = Base64.getUrlDecoder()

    @Test
    fun `verifies what the JDK signs`() {
        val key = TestKey()
        val der = Ed25519.parsePublicKey(key.pem)
        val signature = decoder.decode(key.sign("hello"))
        assertTrue(Ed25519.verify(der, "hello".encodeToByteArray(), signature))
        assertFalse(Ed25519.verify(der, "hellO".encodeToByteArray(), signature))
        assertFalse(Ed25519.verify(der, "hello".encodeToByteArray(), signature.copyOf(63)))
        assertFalse(Ed25519.verify(byteArrayOf(1, 2, 3), "hello".encodeToByteArray(), signature))
    }

    @Test
    fun `refuses anything that is not an Ed25519 PEM public key`() {
        assertFailsWith<Ed25519.InvalidKey> { Ed25519.parsePublicKey("") }
        assertFailsWith<Ed25519.InvalidKey> { Ed25519.parsePublicKey("-----BEGIN PUBLIC KEY-----\n!!!\n-----END PUBLIC KEY-----") }
        assertFailsWith<Ed25519.InvalidKey> { Ed25519.parsePublicKey("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----") }
        assertFailsWith<Ed25519.InvalidKey> { Ed25519.parsePublicKey("x".repeat(5000)) }
    }

    @Test
    fun `fingerprints look like SSH's`() {
        val fingerprint = Ed25519.fingerprint(Ed25519.parsePublicKey(TestKey().pem))
        assertTrue(Regex("^SHA256:[A-Za-z0-9+/]{43}$").matches(fingerprint), fingerprint)
    }

    /** Keys and signatures made by Node's `node:crypto`, which is what the desktop's main process uses. */
    @Test
    fun `verifies signatures made by Node, and agrees on fingerprints`() {
        val fixtures = Json.parseToJsonElement(javaClass.getResource("/ed25519-fixtures.json")!!.readText()).jsonObject
        val der = Ed25519.parsePublicKey(fixtures["publicKey"]!!.jsonPrimitive.content)
        assertEquals(fixtures["fingerprint"]!!.jsonPrimitive.content, Ed25519.fingerprint(der))
        for (case in fixtures["messages"]!!.jsonArray) {
            val message = case.jsonObject["message"]!!.jsonPrimitive.content
            val signature = decoder.decode(case.jsonObject["signature"]!!.jsonPrimitive.content)
            assertTrue(Ed25519.verify(der, message.encodeToByteArray(), signature), message)
        }
        // The texts the desktop signs are the ones this server builds.
        val origin = fixtures["origin"]!!.jsonPrimitive.content
        val nonce = fixtures["nonce"]!!.jsonPrimitive.content
        val byPurpose = fixtures["messages"]!!.jsonArray.associate { it.jsonObject["purpose"]!!.jsonPrimitive.content to it.jsonObject }
        assertEquals(SignedMessages.login(origin, nonce), byPurpose.getValue("login")["message"]!!.jsonPrimitive.content)
        assertEquals(
            SignedMessages.register(origin, nonce, "ana"),
            byPurpose.getValue("register")["message"]!!.jsonPrimitive.content,
        )
    }
}
