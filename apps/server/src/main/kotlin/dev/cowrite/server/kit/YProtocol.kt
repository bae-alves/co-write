package dev.cowrite.server.kit

import java.io.ByteArrayOutputStream

/**
 * Just enough of the Yjs wire format (lib0 encoding + y-protocols sync/awareness framing) to
 * relay and persist updates. The server never decodes the CRDT itself: Yjs updates stay opaque
 * byte arrays.
 *
 * Frames sent by y-websocket:
 *  - `0, 0, varBytes(stateVector)` sync step 1
 *  - `0, 1, varBytes(update)`      sync step 2 (answer to step 1)
 *  - `0, 2, varBytes(update)`      incremental update
 *  - `1, varBytes(awarenessUpdate)`
 *  - `3`                           query awareness
 */
object YProtocol {
    const val MESSAGE_SYNC = 0
    const val MESSAGE_AWARENESS = 1
    const val MESSAGE_AUTH = 2
    const val MESSAGE_QUERY_AWARENESS = 3

    const val SYNC_STEP1 = 0
    const val SYNC_STEP2 = 1
    const val SYNC_UPDATE = 2

    /** A Yjs v1 update with no structs and an empty delete set. */
    val EMPTY_UPDATE = byteArrayOf(0, 0)

    /** A state vector that knows no clients: the answer to it is the sender's full state. */
    val EMPTY_STATE_VECTOR = byteArrayOf(0)

    class Decoder(
        private val bytes: ByteArray,
    ) {
        var position = 0
            private set

        val hasMore: Boolean get() = position < bytes.size

        fun readByte(): Int {
            if (position >= bytes.size) throw MalformedMessage("unexpected end of message")
            return bytes[position++].toInt() and 0xff
        }

        /** lib0 `readVarUint`: 7 bits per byte, little-endian, high bit = more. Up to 53 bits. */
        fun readVarUint(): Long {
            var result = 0L
            var shift = 0
            while (true) {
                val byte = readByte()
                result = result or ((byte and 0x7f).toLong() shl shift)
                if (byte < 0x80) return result
                shift += 7
                if (shift > 53) throw MalformedMessage("varuint too long")
            }
        }

        fun readVarBytes(): ByteArray {
            val length = readVarUint()
            if (length > bytes.size - position) throw MalformedMessage("length past end of message")
            val start = position
            position += length.toInt()
            return bytes.copyOfRange(start, position)
        }

        fun readVarString(): String = readVarBytes().decodeToString()
    }

    class Encoder {
        private val out = ByteArrayOutputStream()

        fun writeVarUint(value: Long): Encoder {
            require(value >= 0) { "negative varuint" }
            var rest = value
            while (rest > 0x7f) {
                out.write(((rest and 0x7f) or 0x80).toInt())
                rest = rest ushr 7
            }
            out.write(rest.toInt())
            return this
        }

        fun writeVarBytes(bytes: ByteArray): Encoder {
            writeVarUint(bytes.size.toLong())
            out.write(bytes)
            return this
        }

        fun writeVarString(value: String): Encoder = writeVarBytes(value.encodeToByteArray())

        fun toByteArray(): ByteArray = out.toByteArray()
    }

    class MalformedMessage(
        message: String,
    ) : Exception(message)

    /** A decoded frame. Anything we do not need to understand is [Other] and is ignored. */
    sealed interface Message {
        data class SyncStep1(
            val stateVector: ByteArray,
        ) : Message

        data class SyncStep2(
            val update: ByteArray,
        ) : Message

        data class Update(
            val update: ByteArray,
        ) : Message

        data class Awareness(
            val entries: List<AwarenessEntry>,
        ) : Message

        data object QueryAwareness : Message

        data object Other : Message
    }

    /** One client's presence. `state` is JSON; the literal `null` means the client left. */
    data class AwarenessEntry(
        val clientId: Long,
        val clock: Long,
        val state: String,
    ) {
        val removed: Boolean get() = state == "null"
    }

    fun decode(frame: ByteArray): Message {
        val decoder = Decoder(frame)
        return when (decoder.readVarUint().toInt()) {
            MESSAGE_SYNC ->
                when (decoder.readVarUint().toInt()) {
                    SYNC_STEP1 -> Message.SyncStep1(decoder.readVarBytes())
                    SYNC_STEP2 -> Message.SyncStep2(decoder.readVarBytes())
                    SYNC_UPDATE -> Message.Update(decoder.readVarBytes())
                    else -> Message.Other
                }
            MESSAGE_AWARENESS -> Message.Awareness(decodeAwareness(decoder.readVarBytes()))
            MESSAGE_QUERY_AWARENESS -> Message.QueryAwareness
            else -> Message.Other
        }
    }

    fun decodeAwareness(update: ByteArray): List<AwarenessEntry> {
        val decoder = Decoder(update)
        val count = decoder.readVarUint()
        if (count > 10_000) throw MalformedMessage("too many awareness entries")
        return List(count.toInt()) {
            AwarenessEntry(decoder.readVarUint(), decoder.readVarUint(), decoder.readVarString())
        }
    }

    private fun sync(
        type: Int,
        payload: ByteArray,
    ): ByteArray =
        Encoder()
            .writeVarUint(MESSAGE_SYNC.toLong())
            .writeVarUint(type.toLong())
            .writeVarBytes(payload)
            .toByteArray()

    fun syncStep1(stateVector: ByteArray): ByteArray = sync(SYNC_STEP1, stateVector)

    fun syncStep2(update: ByteArray): ByteArray = sync(SYNC_STEP2, update)

    fun update(update: ByteArray): ByteArray = sync(SYNC_UPDATE, update)

    fun awareness(entries: Collection<AwarenessEntry>): ByteArray {
        val inner = Encoder().writeVarUint(entries.size.toLong())
        entries.forEach { inner.writeVarUint(it.clientId).writeVarUint(it.clock).writeVarString(it.state) }
        return Encoder()
            .writeVarUint(MESSAGE_AWARENESS.toLong())
            .writeVarBytes(inner.toByteArray())
            .toByteArray()
    }
}
