package dev.cowrite.server.kit

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class SecretsTest {
    @Test
    fun `verifies the right password only`() {
        val hash = Secrets.hashPassword("correct horse", iterations = 1_000)
        assertTrue(Secrets.verifyPassword("correct horse", hash))
        assertFalse(Secrets.verifyPassword("correct horsE", hash))
    }

    @Test
    fun `salts every hash`() {
        assertNotEquals(Secrets.hashPassword("pw", iterations = 1_000), Secrets.hashPassword("pw", iterations = 1_000))
    }

    @Test
    fun `refuses malformed stored hashes`() {
        assertFalse(Secrets.verifyPassword("pw", ""))
        assertFalse(Secrets.verifyPassword("pw", "md5\$1\$a\$b"))
        assertFalse(Secrets.verifyPassword("pw", "pbkdf2-sha256\$x\$a\$b"))
    }

    @Test
    fun `makes url-safe random ids and stable token hashes`() {
        val id = Secrets.randomId(16)
        assertTrue(Regex("^[A-Za-z0-9_-]{22}$").matches(id))
        assertContentEquals(Secrets.hashToken("t"), Secrets.hashToken("t"))
    }
}
