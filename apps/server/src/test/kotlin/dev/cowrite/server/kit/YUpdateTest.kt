package dev.cowrite.server.kit

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Checked against real Yjs updates (see `generate-yjs-fixtures.mjs`). */
class YUpdateTest {
    private class Fixture(
        val name: String,
        val update: ByteArray,
        val stateVector: Map<Long, Long>,
        val highWaterMarks: Map<Long, Long>,
    )

    private val fixtures =
        Json
            .parseToJsonElement(javaClass.getResource("/yjs-fixtures.json")!!.readText())
            .jsonArray
            .map { element ->
                val obj = element.jsonObject
                fun clocks(key: String) = obj.getValue(key).jsonObject.map { (client, clock) -> client.toLong() to clock.jsonPrimitive.long }.toMap()
                Fixture(
                    name = obj.getValue("name").jsonPrimitive.content,
                    update = java.util.HexFormat.of().parseHex(obj.getValue("update").jsonPrimitive.content),
                    stateVector = clocks("stateVector"),
                    highWaterMarks = clocks("highWaterMarks"),
                )
            }

    private fun fixture(name: String) = fixtures.single { it.name == name }

    @Test
    fun `computes the same state vectors and high-water marks as Yjs`() {
        assertTrue(fixtures.size >= 7)
        for (fixture in fixtures) {
            val coverage = YUpdate.coverage(fixture.update)
            assertEquals(fixture.stateVector, coverage.stateVector, "state vector of '${fixture.name}'")
            assertEquals(fixture.highWaterMarks, coverage.highWaterMarks, "high-water marks of '${fixture.name}'")
        }
    }

    @Test
    fun `a full state covers its own incremental updates`() {
        val full = fixture("every content kind").update
        assertTrue(YUpdate.covers(full, listOf(fixture("a single incremental update").update)))
        assertTrue(YUpdate.covers(full, listOf(fixture("text with emoji, format, embed, delete").update)))
        assertTrue(YUpdate.covers(fixture("two clients").update, listOf(full)))
    }

    @Test
    fun `an older or partial state does not cover newer edits`() {
        val older = fixture("text with emoji, format, embed, delete").update
        assertFalse(YUpdate.covers(older, listOf(fixture("every content kind").update)))
        assertFalse(YUpdate.covers(fixture("every content kind").update, listOf(fixture("two clients").update)))
        assertFalse(YUpdate.covers(YProtocol.EMPTY_UPDATE, listOf(older)))
        // A merged update with a gap only covers up to the gap.
        val gap = fixture("merged update with a gap (Skip)").update
        assertFalse(YUpdate.covers(gap, listOf(gap)))
    }

    @Test
    fun `anything covers nothing`() {
        assertTrue(YUpdate.covers(YProtocol.EMPTY_UPDATE, emptyList()))
        assertTrue(YUpdate.covers(YProtocol.EMPTY_UPDATE, listOf(YProtocol.EMPTY_UPDATE)))
    }

    @Test
    fun `malformed bytes never count as covering`() {
        val full = fixture("every content kind").update
        assertFalse(YUpdate.covers(full.copyOf(full.size / 2), listOf(fixture("a single incremental update").update)))
        assertFalse(YUpdate.covers(full, listOf(byteArrayOf(5, 1, 2))))
        assertFailsWith<YProtocol.MalformedMessage> { YUpdate.coverage(byteArrayOf(1, 1, 7, 0, 31)) }
    }
}
