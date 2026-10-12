package dev.cowrite.server

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Real Yjs updates from `src/test/resources/yjs-fixtures.json`, by name. */
object YjsFixtures {
    private val updates: Map<String, ByteArray> =
        Json
            .parseToJsonElement(YjsFixtures::class.java.getResource("/yjs-fixtures.json")!!.readText())
            .jsonArray
            .associate { element ->
                val obj = element.jsonObject
                obj.getValue("name").jsonPrimitive.content to
                    java.util.HexFormat.of().parseHex(obj.getValue("update").jsonPrimitive.content)
            }

    operator fun get(name: String): ByteArray = updates.getValue(name)

    val ana1 get() = this["room: ana 1"]
    val ana2 get() = this["room: ana 2"]
    val ana3 get() = this["room: ana 3"]
    val anaFull get() = this["room: ana full"]
    val boFull get() = this["room: bo full"]
}
