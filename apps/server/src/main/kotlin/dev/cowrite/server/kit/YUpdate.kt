package dev.cowrite.server.kit

/**
 * Reads which edits a Yjs v1 update contains, without applying it: the struct section is walked
 * just far enough to know each struct's client, clock and length. Content is skipped, never
 * interpreted. The delete set at the end is not needed and not read.
 *
 * This is what lets the server check that a snapshot really contains the updates it would
 * replace, without a CRDT implementation of its own.
 */
object YUpdate {
    /** What one update covers, per client id. */
    class Coverage(
        /** Clock up to which the update holds every struct from 0 on (Yjs' own state vector). */
        val stateVector: Map<Long, Long>,
        /** Furthest clock any of its structs reaches, gaps or not. */
        val highWaterMarks: Map<Long, Long>,
    )

    private const val GC = 0
    private const val SKIP = 10
    private const val BIT6 = 0x20
    private const val BIT7 = 0x40
    private const val BIT8 = 0x80

    private const val TYPE_XML_ELEMENT = 3L
    private const val TYPE_XML_HOOK = 5L

    /** Throws [YProtocol.MalformedMessage] if the bytes are not a Yjs v1 update. */
    fun coverage(update: ByteArray): Coverage {
        val decoder = YProtocol.Decoder(update)
        val stateVector = mutableMapOf<Long, Long>()
        val marks = mutableMapOf<Long, Long>()
        repeat(decoder.readCount()) {
            val structs = decoder.readCount()
            val client = decoder.readVarUint()
            var clock = decoder.readVarUint()
            var contiguous = clock == 0L
            repeat(structs) {
                val info = decoder.readByte()
                val length =
                    when (info and 0x1f) {
                        GC -> decoder.readVarUint()
                        SKIP -> {
                            contiguous = false
                            decoder.readVarUint()
                        }
                        else -> readItem(decoder, info)
                    }
                clock += length
                if (info and 0x1f != SKIP) marks[client] = maxOf(marks[client] ?: 0, clock)
                if (contiguous) stateVector[client] = clock
            }
        }
        return Coverage(stateVector, marks)
    }

    /**
     * True when `snapshot` contains every struct of every update in `replaced`, so the log entries
     * can be deleted without losing anything. Malformed input is never considered covered.
     */
    fun covers(
        snapshot: ByteArray,
        replaced: List<ByteArray>,
    ): Boolean =
        try {
            val have = coverage(snapshot).stateVector
            replaced.all { update ->
                coverage(update).highWaterMarks.all { (client, clock) -> (have[client] ?: 0) >= clock }
            }
        } catch (e: YProtocol.MalformedMessage) {
            false
        }

    /** Skips one Item's header and content; returns its length in clock units. */
    private fun readItem(
        decoder: YProtocol.Decoder,
        info: Int,
    ): Long {
        if (info and BIT8 != 0) decoder.skipId() // origin
        if (info and BIT7 != 0) decoder.skipId() // right origin
        if (info and (BIT7 or BIT8) == 0) {
            // No neighbours to copy the parent from: the parent is spelled out.
            if (decoder.readVarUint() == 1L) decoder.readVarBytes() else decoder.skipId()
            if (info and BIT6 != 0) decoder.readVarBytes() // parent sub (map key)
        }
        return when (info and 0x1f) {
            1 -> decoder.readVarUint() // deleted
            2 -> decoder.readVarUint().also { n -> repeat(n.toInt()) { decoder.readVarBytes() } } // JSON
            3 -> 1L.also { decoder.readVarBytes() } // binary
            4 -> decoder.readVarString().length.toLong() // string, in UTF-16 code units like JS
            5 -> 1L.also { decoder.readVarBytes() } // embed (JSON)
            6 -> 1L.also { decoder.readVarBytes().also { decoder.readVarBytes() } } // format: key + JSON
            7 -> 1L.also { if (decoder.readVarUint() in setOf(TYPE_XML_ELEMENT, TYPE_XML_HOOK)) decoder.readVarBytes() } // type
            8 -> decoder.readVarUint().also { n -> repeat(n.toInt()) { decoder.skipAny() } } // any
            9 -> 1L.also { decoder.readVarBytes().also { decoder.skipAny() } } // subdocument: guid + options
            else -> throw YProtocol.MalformedMessage("unknown content type ${info and 0x1f}")
        }
    }

    private fun YProtocol.Decoder.readCount(): Int {
        val count = readVarUint()
        if (count > Int.MAX_VALUE) throw YProtocol.MalformedMessage("count too large")
        return count.toInt()
    }

    private fun YProtocol.Decoder.skipId() {
        readVarUint()
        readVarUint()
    }

    /** lib0 `readAny`: a type tag (127 − n) followed by the value. */
    private fun YProtocol.Decoder.skipAny(depth: Int = 0) {
        if (depth > 100) throw YProtocol.MalformedMessage("value nested too deeply")
        when (val tag = readByte()) {
            127, 126, 121, 120 -> Unit // undefined, null, false, true
            125 -> readVarInt()
            124 -> skip(4) // float32
            123, 122 -> skip(8) // float64, bigint
            119, 116 -> readVarBytes() // string, Uint8Array
            118 -> repeat(readCount()) { readVarBytes().also { skipAny(depth + 1) } } // object
            117 -> repeat(readCount()) { skipAny(depth + 1) } // array
            else -> throw YProtocol.MalformedMessage("unknown value tag $tag")
        }
    }

    /** lib0 `readVarInt`: first byte holds a sign bit and 6 value bits, then 7 bits per byte. */
    private fun YProtocol.Decoder.readVarInt() {
        var byte = readByte()
        while (byte and 0x80 != 0) byte = readByte()
    }

    private fun YProtocol.Decoder.skip(bytes: Int) = repeat(bytes) { readByte() }
}
