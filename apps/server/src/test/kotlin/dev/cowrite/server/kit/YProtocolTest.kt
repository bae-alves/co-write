package dev.cowrite.server.kit

import dev.cowrite.server.kit.YProtocol.AwarenessEntry
import dev.cowrite.server.kit.YProtocol.Message
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

class YProtocolTest {
    private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

    @Test
    fun `varuints match lib0`() {
        assertContentEquals(bytes(0), YProtocol.Encoder().writeVarUint(0).toByteArray())
        assertContentEquals(bytes(127), YProtocol.Encoder().writeVarUint(127).toByteArray())
        assertContentEquals(bytes(0x80, 0x01), YProtocol.Encoder().writeVarUint(128).toByteArray())
        assertContentEquals(bytes(0xAC, 0x02), YProtocol.Encoder().writeVarUint(300).toByteArray())
        // Yjs client ids are uint32.
        val max = 4_294_967_295L
        assertEquals(max, YProtocol.Decoder(YProtocol.Encoder().writeVarUint(max).toByteArray()).readVarUint())
    }

    @Test
    fun `frames sync messages like y-protocols`() {
        assertContentEquals(bytes(0, 0, 1, 0), YProtocol.syncStep1(YProtocol.EMPTY_STATE_VECTOR))
        assertContentEquals(bytes(0, 1, 2, 0, 0), YProtocol.syncStep2(YProtocol.EMPTY_UPDATE))
        assertContentEquals(bytes(0, 2, 3, 7, 8, 9), YProtocol.update(bytes(7, 8, 9)))
    }

    @Test
    fun `decodes sync messages`() {
        assertIs<Message.SyncStep1>(YProtocol.decode(bytes(0, 0, 1, 0)))
        val step2 = assertIs<Message.SyncStep2>(YProtocol.decode(bytes(0, 1, 2, 5, 6)))
        assertContentEquals(bytes(5, 6), step2.update)
        val update = assertIs<Message.Update>(YProtocol.decode(bytes(0, 2, 1, 4)))
        assertContentEquals(bytes(4), update.update)
        assertEquals(Message.QueryAwareness, YProtocol.decode(bytes(3)))
        assertEquals(Message.Other, YProtocol.decode(bytes(2, 0)))
        assertEquals(Message.Other, YProtocol.decode(bytes(9)))
    }

    @Test
    fun `round-trips awareness`() {
        val entries =
            listOf(
                AwarenessEntry(3_000_000_000, 4, """{"user":{"name":"ana"}}"""),
                AwarenessEntry(7, 1, "null"),
            )
        val decoded = assertIs<Message.Awareness>(YProtocol.decode(YProtocol.awareness(entries)))
        assertEquals(entries, decoded.entries)
        assertEquals(listOf(false, true), decoded.entries.map { it.removed })
    }

    @Test
    fun `rejects truncated or oversized input`() {
        assertFailsWith<YProtocol.MalformedMessage> { YProtocol.decode(bytes()) }
        assertFailsWith<YProtocol.MalformedMessage> { YProtocol.decode(bytes(0, 2, 5, 1)) }
        assertFailsWith<YProtocol.MalformedMessage> {
            YProtocol.decode(bytes(0, 2, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01))
        }
    }
}
