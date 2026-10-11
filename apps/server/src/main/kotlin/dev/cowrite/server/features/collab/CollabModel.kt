package dev.cowrite.server.features.collab

import dev.cowrite.server.kit.YProtocol.AwarenessEntry

/** One stored Yjs update (or, after compaction, a snapshot standing in for all updates up to `seq`). */
class StoredUpdate(
    val seq: Long,
    val data: ByteArray,
)

/** What the room knows about one connection. */
data class PeerState(
    val canWrite: Boolean,
    /** The peer's first sync step 1 has been answered (and its full state requested). */
    val greeted: Boolean = false,
    /**
     * We asked this peer for its full state (sync step 1 with an empty state vector). Its answer
     * contains every update up to this seq, so it may replace them as a snapshot.
     */
    val snapshotUpTo: Long? = null,
    /** Awareness client ids this connection announced; cleared for everyone when it leaves. */
    val clientIds: Set<Long> = emptySet(),
)

/**
 * A document room. Immutable: the intent computes the next value under the room's lock.
 *
 * @property lastSeq seq of the newest stored update (0 when the log is empty)
 * @property sinceSnapshot updates stored after the last snapshot; drives compaction
 * @property awareness latest presence per client id, replayed to peers that join
 */
data class RoomState(
    val lastSeq: Long,
    val sinceSnapshot: Int,
    val peers: Map<Long, PeerState> = emptyMap(),
    val awareness: Map<Long, AwarenessEntry> = emptyMap(),
)
