package dev.cowrite.server.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PkceTest {
    // RFC 7636, appendix B.
    private val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    private val challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

    @Test
    fun `computes the RFC's example challenge`() {
        assertEquals(challenge, Pkce.challengeOf(verifier))
        assertTrue(Pkce.matches(verifier, challenge))
    }

    @Test
    fun `rejects other verifiers and malformed values`() {
        assertFalse(Pkce.matches("x".repeat(43), challenge))
        assertFalse(Pkce.matches("short", challenge))
        assertTrue(Pkce.isChallenge(challenge))
        assertFalse(Pkce.isChallenge("too-short"))
        assertFalse(Pkce.isChallenge("$challenge="))
    }
}
