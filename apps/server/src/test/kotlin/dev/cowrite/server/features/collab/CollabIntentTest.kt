package dev.cowrite.server.features.collab

import dev.cowrite.server.FakeDatabase
import dev.cowrite.server.YjsFixtures
import dev.cowrite.server.kit.YProtocol
import dev.cowrite.server.kit.YProtocol.AwarenessEntry
import dev.cowrite.server.kit.YProtocol.Message
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A connection that records what the room sends it. Updates are opaque, so any bytes will do. */
private class FakePeer(
    override val id: Long,
) : Peer {
    val inbox = mutableListOf<Message>()

    override fun send(frame: ByteArray) {
        inbox += YProtocol.decode(frame)
    }

    fun take(): List<Message> = inbox.toList().also { inbox.clear() }
}

private fun u(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

private fun List<Message>.updates() = filterIsInstance<Message.Update>().map { it.update.toList() }

class CollabIntentTest {
    private val db = FakeDatabase()
    private val doc = "doc1"

    private fun log() = runBlocking { db.collab.load(doc) }.map { it.seq to it.data.toList() }

    /** Joins and completes the y-websocket handshake (client step 1 → replay + step 1 back). */
    private suspend fun CollabIntents.connect(
        peer: FakePeer,
        canWrite: Boolean = true,
    ) {
        join(doc, peer, canWrite)
        receive(doc, peer, YProtocol.syncStep1(YProtocol.EMPTY_STATE_VECTOR))
    }

    @Test
    fun `answers a client's step 1 with the log, then asks a writer for its full state`() =
        runBlocking {
            val collab = CollabIntents(db.collab)
            db.collab.append(doc, 1, u(1), 0)
            db.collab.append(doc, 2, u(2), 0)
            val ana = FakePeer(1)
            collab.connect(ana)
            val messages = ana.take()
            assertEquals(listOf(listOf<Byte>(1), listOf<Byte>(2)), messages.updates())
            val step2 = messages.filterIsInstance<Message.SyncStep2>().single()
            assertContentEquals(YProtocol.EMPTY_UPDATE, step2.update)
            assertTrue(messages.last() is Message.SyncStep1, "full-state request comes after the replay")
        }

    @Test
    fun `relays updates to the other peers and stores them in order`() =
        runBlocking {
            val collab = CollabIntents(db.collab)
            val ana = FakePeer(1)
            val bo = FakePeer(2)
            collab.connect(ana)
            collab.connect(bo)
            ana.take()
            bo.take()

            collab.receive(doc, ana, YProtocol.update(u(10)))
            collab.receive(doc, bo, YProtocol.update(u(20)))
            assertEquals(listOf(listOf<Byte>(20)), ana.take().updates())
            assertEquals(listOf(listOf<Byte>(10)), bo.take().updates())
            assertEquals(listOf(1L to listOf<Byte>(10), 2L to listOf<Byte>(20)), log())
        }

    @Test
    fun `drops updates from viewers but keeps them informed`() =
        runBlocking {
            val collab = CollabIntents(db.collab)
            val ana = FakePeer(1)
            val viewer = FakePeer(2)
            collab.connect(ana)
            collab.connect(viewer, canWrite = false)
            assertTrue(viewer.take().none { it is Message.SyncStep1 }, "viewers are never asked for state")
            ana.take()

            collab.receive(doc, viewer, YProtocol.update(u(66)))
            collab.receive(doc, viewer, YProtocol.syncStep2(u(67)))
            assertEquals(emptyList(), ana.take().updates())
            assertEquals(emptyList(), log())

            collab.receive(doc, ana, YProtocol.update(u(1)))
            assertEquals(listOf(listOf<Byte>(1)), viewer.take().updates())
        }

    @Test
    fun `a reconnecting writer's full state carries its offline edits and compacts the log`() =
        runBlocking {
            val collab = CollabIntents(db.collab)
            val ana = FakePeer(1)
            val bo = FakePeer(2)
            collab.connect(ana)
            collab.receive(doc, ana, YProtocol.syncStep2(YProtocol.EMPTY_UPDATE)) // nothing local yet
            collab.receive(doc, ana, YProtocol.update(YjsFixtures.ana1))
            collab.receive(doc, ana, YProtocol.update(YjsFixtures.ana2))

            // bo was offline and edited; on connect it gets the log, then answers our step 1.
            collab.connect(bo)
            assertEquals(listOf(YjsFixtures.ana1.toList(), YjsFixtures.ana2.toList()), bo.take().updates())
            ana.take()
            collab.receive(doc, bo, YProtocol.syncStep2(YjsFixtures.boFull)) // the log + its offline edit

            assertEquals(listOf(YjsFixtures.boFull.toList()), ana.take().updates(), "offline edits reach others")
            assertEquals(listOf(2L to YjsFixtures.boFull.toList()), log(), "the snapshot replaced updates 1..2")

            collab.receive(doc, ana, YProtocol.update(YjsFixtures.ana3))
            assertEquals(listOf(2L to YjsFixtures.boFull.toList(), 3L to YjsFixtures.ana3.toList()), log())
        }

    @Test
    fun `keeps history a snapshot does not cover`() =
        runBlocking {
            val collab = CollabIntents(db.collab)
            val ana = FakePeer(1)
            val bo = FakePeer(2)
            collab.connect(ana)
            collab.receive(doc, ana, YProtocol.syncStep2(YProtocol.EMPTY_UPDATE))
            listOf(YjsFixtures.ana1, YjsFixtures.ana2, YjsFixtures.ana3).forEach {
                collab.receive(doc, ana, YProtocol.update(it))
            }

            // bo answers with a state that lacks ana's third edit (a buggy or stale client).
            collab.connect(bo)
            collab.receive(doc, bo, YProtocol.syncStep2(YjsFixtures.anaFull))

            assertEquals(listOf(1L, 2L, 3L, 4L), log().map { it.first }, "nothing deleted; the state is kept as an update")
            assertEquals(YjsFixtures.anaFull.toList(), log().last().second)
        }

    @Test
    fun `never compacts with something that is not a Yjs update`() =
        runBlocking {
            val collab = CollabIntents(db.collab)
            val ana = FakePeer(1)
            val bo = FakePeer(2)
            collab.connect(ana)
            collab.receive(doc, ana, YProtocol.syncStep2(YProtocol.EMPTY_UPDATE))
            collab.receive(doc, ana, YProtocol.update(YjsFixtures.ana1))
            collab.connect(bo)
            collab.receive(doc, bo, YProtocol.syncStep2(u(1, 2, 3)))
            assertEquals(listOf(1L, 2L), log().map { it.first })
        }

    @Test
    fun `asks for a snapshot after enough updates`() =
        runBlocking {
            val collab = CollabIntents(db.collab, compactAfter = 2)
            val ana = FakePeer(1)
            collab.connect(ana)
            collab.receive(doc, ana, YProtocol.syncStep2(YProtocol.EMPTY_UPDATE))
            ana.take()
            collab.receive(doc, ana, YProtocol.update(YjsFixtures.ana1))
            collab.receive(doc, ana, YProtocol.update(YjsFixtures.ana2))
            assertTrue(ana.take().last() is Message.SyncStep1)
            collab.receive(doc, ana, YProtocol.syncStep2(YjsFixtures.anaFull))
            assertEquals(listOf(2L to YjsFixtures.anaFull.toList()), log())
        }

    @Test
    fun `replays presence to newcomers and clears it when a peer leaves`() =
        runBlocking {
            val collab = CollabIntents(db.collab)
            val ana = FakePeer(1)
            val bo = FakePeer(2)
            collab.connect(ana)
            collab.receive(doc, ana, YProtocol.awareness(listOf(AwarenessEntry(111, 1, """{"user":{"name":"ana"}}"""))))
            assertTrue(ana.take().any { it is Message.Awareness }, "awareness is echoed to the sender (keep-alive)")

            collab.join(doc, bo, true)
            val seen = bo.take().filterIsInstance<Message.Awareness>().single()
            assertEquals(111, seen.entries.single().clientId)

            collab.leave(doc, ana)
            val gone = bo.take().filterIsInstance<Message.Awareness>().single().entries.single()
            assertEquals(111, gone.clientId)
            assertTrue(gone.removed)
            assertEquals(2, gone.clock)
        }

    @Test
    fun `forgets the room when the last peer leaves`() =
        runBlocking {
            val collab = CollabIntents(db.collab)
            val ana = FakePeer(1)
            collab.connect(ana)
            assertEquals(setOf(doc), collab.openRooms())
            collab.leave(doc, ana)
            assertEquals(emptySet(), collab.openRooms())
        }

    @Test
    fun `ignores malformed frames`() =
        runBlocking {
            val collab = CollabIntents(db.collab)
            val ana = FakePeer(1)
            collab.connect(ana)
            ana.take()
            collab.receive(doc, ana, u(0, 2, 50, 1))
            collab.receive(doc, ana, u())
            assertEquals(emptyList(), ana.take())
            assertEquals(emptyList(), log())
        }
}
