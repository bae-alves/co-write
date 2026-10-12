package dev.cowrite.server.features.collab

import dev.cowrite.server.kit.YProtocol
import dev.cowrite.server.kit.YProtocol.AwarenessEntry
import dev.cowrite.server.kit.YProtocol.Message
import dev.cowrite.server.kit.YUpdate
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One WebSocket connection, as the room sees it. */
interface Peer {
    val id: Long

    /** Queues a frame for this connection. Must not block: it is called with the room locked. */
    fun send(frame: ByteArray)
}

/**
 * Document rooms: join/leave, relay of Yjs updates and awareness, and persistence of the update
 * log. The server never merges CRDT state itself. Instead:
 *
 *  - A connecting peer's sync step 1 is answered with every stored update, then an (empty) sync
 *    step 2 so it knows it is in sync, then our own sync step 1 with an empty state vector. Its
 *    answer is its full state: that carries edits made offline to the server, and — since it was
 *    requested after the replay — it should contain every stored update, so it replaces them as
 *    a snapshot (compaction). The server checks that it does ([YUpdate.covers]) before deleting
 *    anything; a snapshot that falls short is stored as an ordinary update instead.
 *  - Every update from a writer is appended to the log and relayed to the other peers.
 *  - After [compactAfter] updates the server asks a writer for its full state again.
 *  - Viewers receive everything; their updates are dropped.
 */
class CollabIntents(
    private val repository: CollabRepository,
    private val compactAfter: Int = 200,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private class Room(
        val documentId: String,
    ) {
        val lock = Mutex()
        var state: RoomState? = null
        val connections = mutableMapOf<Long, Peer>()
        var members = 0
    }

    private val registry = Mutex()
    private val rooms = mutableMapOf<String, Room>()

    /** Rooms currently held in memory (for tests and monitoring). */
    suspend fun openRooms(): Set<String> = registry.withLock { rooms.keys.toSet() }

    private suspend fun enter(documentId: String): Room =
        registry.withLock {
            rooms.getOrPut(documentId) { Room(documentId) }.also { it.members++ }
        }

    private suspend fun exit(
        documentId: String,
        room: Room,
    ) {
        registry.withLock {
            room.members--
            if (room.members == 0) rooms.remove(documentId)
        }
    }

    private suspend fun room(documentId: String): Room? = registry.withLock { rooms[documentId] }

    /** Every stored update, then an empty sync step 2 so the client knows it is in sync. */
    private fun replay(
        log: List<StoredUpdate>,
        peer: Peer,
    ) {
        log.forEach { peer.send(YProtocol.update(it.data)) }
        peer.send(YProtocol.syncStep2(YProtocol.EMPTY_UPDATE))
    }

    private fun Room.broadcast(
        frame: ByteArray,
        except: Long? = null,
    ) {
        connections.forEach { (id, peer) -> if (id != except) peer.send(frame) }
    }

    suspend fun join(
        documentId: String,
        peer: Peer,
        canWrite: Boolean,
    ) {
        val room = enter(documentId)
        try {
            room.lock.withLock {
                val state =
                    room.state ?: repository.load(documentId).let { log ->
                        RoomState(lastSeq = log.maxOfOrNull { it.seq } ?: 0, sinceSnapshot = log.size)
                    }
                room.connections[peer.id] = peer
                if (state.awareness.isNotEmpty()) peer.send(YProtocol.awareness(state.awareness.values))
                val me = PeerState(canWrite = canWrite)
                room.state = state.copy(peers = state.peers + (peer.id to me))
            }
        } catch (e: Throwable) {
            room.lock.withLock { room.connections.remove(peer.id) }
            exit(documentId, room)
            throw e
        }
    }

    suspend fun receive(
        documentId: String,
        peer: Peer,
        frame: ByteArray,
    ) {
        val message =
            try {
                YProtocol.decode(frame)
            } catch (e: YProtocol.MalformedMessage) {
                return
            }
        val room = room(documentId) ?: return
        room.lock.withLock {
            val state = room.state ?: return
            val me = state.peers[peer.id] ?: return
            room.state =
                when (message) {
                    is Message.SyncStep1 -> answerSyncStep1(room, state, peer, me)
                    is Message.SyncStep2 -> storeFullState(room, state, peer, me, message.update)
                    is Message.Update -> storeUpdate(room, state, peer, me, message.update)
                    is Message.Awareness -> relayAwareness(room, state, peer, me, message.entries, frame)
                    Message.QueryAwareness -> {
                        if (state.awareness.isNotEmpty()) peer.send(YProtocol.awareness(state.awareness.values))
                        state
                    }
                    Message.Other -> state
                }
        }
    }

    /**
     * y-websocket sends step 1 when it connects (and on resync). The answer is the whole log.
     * The first time, a writer is then asked for its full state; because that request is queued
     * after the replay, the answer covers every stored update and can replace them.
     */
    private suspend fun answerSyncStep1(
        room: Room,
        state: RoomState,
        peer: Peer,
        me: PeerState,
    ): RoomState {
        replay(repository.load(room.documentId), peer)
        if (me.greeted) return state
        var next = me.copy(greeted = true)
        if (me.canWrite) {
            peer.send(YProtocol.syncStep1(YProtocol.EMPTY_STATE_VECTOR))
            next = next.copy(snapshotUpTo = state.lastSeq)
        }
        return state.copy(peers = state.peers + (peer.id to next))
    }

    private suspend fun storeFullState(
        room: Room,
        state: RoomState,
        peer: Peer,
        me: PeerState,
        update: ByteArray,
    ): RoomState {
        if (!me.canWrite) return state
        val upTo = me.snapshotUpTo
        val done = state.copy(peers = state.peers + (peer.id to me.copy(snapshotUpTo = null)))
        if (update.contentEquals(YProtocol.EMPTY_UPDATE)) return done
        if (upTo == null) return storeUpdate(room, done, peer, me, update)
        // Only replace history the snapshot provably contains; otherwise keep it as an update.
        val replaced = repository.load(room.documentId).filter { it.seq <= upTo }.map { it.data }
        if (!YUpdate.covers(update, replaced)) return storeUpdate(room, done, peer, me, update)
        repository.compact(room.documentId, upTo, update)
        room.broadcast(YProtocol.update(update), except = peer.id)
        return done.copy(sinceSnapshot = (state.lastSeq - upTo).toInt())
    }

    private suspend fun storeUpdate(
        room: Room,
        state: RoomState,
        peer: Peer,
        me: PeerState,
        update: ByteArray,
    ): RoomState {
        if (!me.canWrite || update.contentEquals(YProtocol.EMPTY_UPDATE)) return state
        val seq = state.lastSeq + 1
        repository.append(room.documentId, seq, update, now())
        room.broadcast(YProtocol.update(update), except = peer.id)
        var next = state.copy(lastSeq = seq, sinceSnapshot = state.sinceSnapshot + 1)
        val snapshotRequested = next.peers.values.any { it.snapshotUpTo != null }
        if (next.sinceSnapshot >= compactAfter && !snapshotRequested) {
            // Everything up to `seq` has been sent to this peer (or came from it), in order.
            peer.send(YProtocol.syncStep1(YProtocol.EMPTY_STATE_VECTOR))
            next = next.copy(peers = next.peers + (peer.id to me.copy(snapshotUpTo = seq)))
        }
        return next
    }

    private fun relayAwareness(
        room: Room,
        state: RoomState,
        peer: Peer,
        me: PeerState,
        entries: List<AwarenessEntry>,
        frame: ByteArray,
    ): RoomState {
        var awareness = state.awareness
        for (entry in entries) {
            val known = awareness[entry.clientId]
            if (known != null && known.clock > entry.clock) continue
            awareness = if (entry.removed) awareness - entry.clientId else awareness + (entry.clientId to entry)
        }
        // Echoed to the sender as well: y-websocket treats any message as a keep-alive.
        room.broadcast(frame)
        val clientIds = me.clientIds + entries.filterNot { it.removed }.map { it.clientId }
        return state.copy(awareness = awareness, peers = state.peers + (peer.id to me.copy(clientIds = clientIds)))
    }

    suspend fun leave(
        documentId: String,
        peer: Peer,
    ) {
        val room = room(documentId) ?: return
        room.lock.withLock {
            room.connections.remove(peer.id)
            val state = room.state ?: return@withLock
            val me = state.peers[peer.id]
            val gone = me?.clientIds.orEmpty().mapNotNull { state.awareness[it] }
            if (gone.isNotEmpty()) {
                room.broadcast(YProtocol.awareness(gone.map { it.copy(clock = it.clock + 1, state = "null") }))
            }
            room.state = state.copy(peers = state.peers - peer.id, awareness = state.awareness - me?.clientIds.orEmpty())
        }
        exit(documentId, room)
    }
}
