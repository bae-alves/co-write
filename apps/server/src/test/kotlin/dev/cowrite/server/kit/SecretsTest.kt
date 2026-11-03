package dev.cowrite.server.kit

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class SecretsTest {
    @Test
    fun `makes url-safe random ids and stable token hashes`() {
        val id = Secrets.randomId(16)
        assertTrue(Regex("^[A-Za-z0-9_-]{22}$").matches(id))
        assertNotEquals(id, Secrets.randomId(16))
        assertContentEquals(Secrets.hashToken("t"), Secrets.hashToken("t"))
        assertNotEquals(Secrets.hashToken("t").toList(), Secrets.hashToken("u").toList())
    }
}
