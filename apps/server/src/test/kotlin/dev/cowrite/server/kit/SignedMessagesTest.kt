package dev.cowrite.server.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SignedMessagesTest {
    @Test
    fun `names the purpose, origin and nonce`() {
        assertEquals("co-write-login\nhttps://a.example\nn1", SignedMessages.login("https://a.example", "n1"))
        assertEquals("co-write-register\nhttps://a.example\nn1\nana", SignedMessages.register("https://a.example", "n1", "ana"))
    }

    @Test
    fun `normalizes origins the way the desktop's URL parser does`() {
        assertEquals("https://write.example.com", SignedMessages.normalizeOrigin("HTTPS://Write.Example.com/"))
        assertEquals("https://write.example.com", SignedMessages.normalizeOrigin("https://write.example.com:443/some/path?x=1"))
        assertEquals("http://localhost:8080", SignedMessages.normalizeOrigin(" http://localhost:8080 "))
        assertEquals("http://localhost", SignedMessages.normalizeOrigin("http://localhost:80"))
        assertEquals("https://10.0.0.5:9443", SignedMessages.normalizeOrigin("https://10.0.0.5:9443"))
        assertNull(SignedMessages.normalizeOrigin("ftp://example.com"))
        assertNull(SignedMessages.normalizeOrigin("not a url"))
        assertNull(SignedMessages.normalizeOrigin(""))
    }
}
