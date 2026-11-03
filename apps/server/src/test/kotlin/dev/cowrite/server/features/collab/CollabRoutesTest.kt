package dev.cowrite.server.features.collab

import dev.cowrite.server.FakeDatabase
import dev.cowrite.server.YjsFixtures
import dev.cowrite.server.features.auth.jsonField
import dev.cowrite.server.features.auth.postJson
import dev.cowrite.server.features.auth.register
import dev.cowrite.server.kit.YProtocol
import dev.cowrite.server.kit.YProtocol.Message
import dev.cowrite.server.module
import dev.cowrite.server.testConfig
import dev.cowrite.server.testDependencies
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.delete
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.ktor.websocket.Frame
import io.ktor.websocket.readBytes
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

private fun u(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

/** Reads frames until one decodes to a message `T`. */
private suspend inline fun <reified T : Message> DefaultClientWebSocketSession.expect(): T =
    withTimeout(5_000) {
        while (true) {
            val frame = incoming.receive()
            if (frame !is Frame.Binary) continue
            val message = YProtocol.decode(frame.readBytes())
            if (message is T) return@withTimeout message
        }
        @Suppress("UNREACHABLE_CODE")
        error("unreachable")
    }

/** What y-websocket does on open: send step 1, then answer the server's step 1 with our state. */
private suspend fun DefaultClientWebSocketSession.handshake(fullState: ByteArray = YProtocol.EMPTY_UPDATE): List<ByteArray> {
    send(Frame.Binary(true, YProtocol.syncStep1(YProtocol.EMPTY_STATE_VECTOR)))
    val replayed = mutableListOf<ByteArray>()
    withTimeout(5_000) {
        while (true) {
            val frame = incoming.receive() as? Frame.Binary ?: continue
            when (val message = YProtocol.decode(frame.readBytes())) {
                is Message.Update -> replayed += message.update
                is Message.SyncStep2 -> break
                else -> Unit
            }
        }
    }
    return replayed
}

/** Waits until the server has handled every frame sent so far (it handles a socket's frames in order). */
private suspend fun DefaultClientWebSocketSession.awaitHandled() {
    handshake()
}

private suspend fun DefaultClientWebSocketSession.answerStateRequest(fullState: ByteArray) {
    expect<Message.SyncStep1>()
    send(Frame.Binary(true, YProtocol.syncStep2(fullState)))
}

class CollabRoutesTest {
    private val db = FakeDatabase()

    private fun withServer(block: suspend ApplicationTestBuilder.(HttpClient) -> Unit) =
        testApplication {
            application { module(testConfig, testDependencies(db)) }
            block(createClient { install(WebSockets) })
        }

    private suspend fun HttpClient.newDocument(token: String): String =
        Json
            .parseToJsonElement(postJson("/api/docs", """{"title":"Doc"}""", token).bodyAsText())
            .jsonObject["id"]!!
            .jsonPrimitive.content

    private suspend fun HttpClient.share(
        token: String,
        id: String,
        username: String,
        role: String,
    ) = put("/api/docs/$id/members") {
        bearerAuth(token)
        contentType(ContentType.Application.Json)
        setBody("""{"username":"$username","role":"$role"}""")
    }

    private suspend fun HttpClient.closeCode(path: String): Short? {
        var code: Short? = null
        webSocket(path) { code = closeReason.await()?.code }
        return code
    }

    private suspend fun HttpClient.ticket(
        token: String,
        id: String,
    ): String = postJson("/api/ws-ticket", """{"docId":"$id"}""", token).bodyAsText().jsonField("ticket")

    /** What the desktop does: trade the session token for a single-use ticket, then connect with it. */
    private suspend fun HttpClient.docSocket(
        id: String,
        token: String,
        block: suspend DefaultClientWebSocketSession.() -> Unit,
    ) = webSocket("/ws/docs/$id?ticket=${ticket(token, id)}", block = block)

    private suspend fun DefaultClientWebSocketSession.closedWith(): Short? =
        withTimeout(5_000) {
            for (frame in incoming) Unit
            closeReason.await()?.code
        }

    @Test
    fun `refuses unauthenticated, unknown and foreign documents with terminal close codes`() =
        withServer { ws ->
            val ana = client.register("ana")
            val bo = client.register("bo")
            val id = client.newDocument(ana)
            assertEquals(CollabCloseCode.UNAUTHENTICATED, ws.closeCode("/ws/docs/$id"))
            assertEquals(CollabCloseCode.UNAUTHENTICATED, ws.closeCode("/ws/docs/$id?ticket=bogus"))
            // The session token is no longer accepted in the URL, valid or not.
            assertEquals(CollabCloseCode.UNAUTHENTICATED, ws.closeCode("/ws/docs/$id?token=$ana"))
            // A ticket is not even issued for a document the caller cannot open.
            assertEquals(HttpStatusCode.Forbidden, ws.postJson("/api/ws-ticket", """{"docId":"$id"}""", bo).status)
            assertEquals(HttpStatusCode.NotFound, ws.postJson("/api/ws-ticket", """{"docId":"nope"}""", ana).status)
            assertEquals(HttpStatusCode.Unauthorized, ws.postJson("/api/ws-ticket", """{"docId":"$id"}""").status)
        }

    @Test
    fun `a ticket works once, for its own document, and expires`() {
        var now = 1_000_000L
        testApplication {
            application { module(testConfig, testDependencies(db, now = { now })) }
            val ws = createClient { install(WebSockets) }
            val ana = ws.register("ana")
            val first = ws.newDocument(ana)
            val second = ws.newDocument(ana)

            val ticket = ws.ticket(ana, first)
            assertEquals(CollabCloseCode.UNAUTHENTICATED, ws.closeCode("/ws/docs/$second?ticket=$ticket"))
            // The wrong-document attempt spent it.
            assertEquals(CollabCloseCode.UNAUTHENTICATED, ws.closeCode("/ws/docs/$first?ticket=$ticket"))

            val used = ws.ticket(ana, first)
            ws.webSocket("/ws/docs/$first?ticket=$used") { handshake() }
            assertEquals(CollabCloseCode.UNAUTHENTICATED, ws.closeCode("/ws/docs/$first?ticket=$used"))

            val stale = ws.ticket(ana, first)
            now += 31_000
            assertEquals(CollabCloseCode.UNAUTHENTICATED, ws.closeCode("/ws/docs/$first?ticket=$stale"))
        }
    }

    @Test
    fun `a role change closes the open socket, and the reconnect gets the new role`() =
        withServer { ws ->
            val ana = client.register("ana")
            val bo = client.register("bo")
            val id = client.newDocument(ana)
            client.share(ana, id, "bo", "editor")

            ws.docSocket(id, bo) {
                handshake()
                answerStateRequest(YProtocol.EMPTY_UPDATE)
                assertEquals(HttpStatusCode.NoContent, client.share(ana, id, "bo", "viewer").status)
                assertEquals(CollabCloseCode.ROLE_CHANGED, closedWith())
            }
            // Not in the no-reconnect range: y-websocket reconnects by itself.
            assertTrue(CollabCloseCode.ROLE_CHANGED !in 4400..4499)

            ws.docSocket(id, bo) {
                handshake()
                send(Frame.Binary(true, YProtocol.update(u(9))))
                awaitHandled()
            }
            ws.docSocket(id, ana) { assertEquals(emptyList(), handshake().map { it.toList() }) }
        }

    @Test
    fun `removing a member closes their socket for good and keeps them out`() =
        withServer { ws ->
            val ana = client.register("ana")
            val bo = client.register("bo")
            val id = client.newDocument(ana)
            client.share(ana, id, "bo", "editor")

            ws.docSocket(id, bo) {
                handshake()
                val removed = client.delete("/api/docs/$id/members/bo") { bearerAuth(ana) }
                assertEquals(HttpStatusCode.NoContent, removed.status)
                assertEquals(CollabCloseCode.FORBIDDEN, closedWith())
            }
            assertEquals(HttpStatusCode.Forbidden, ws.postJson("/api/ws-ticket", """{"docId":"$id"}""", bo).status)
        }

    @Test
    fun `deleting an account closes its sockets`() =
        withServer { ws ->
            val ana = client.register("ana")
            val id = client.newDocument(ana)
            ws.docSocket(id, ana) {
                handshake()
                client.delete("/api/me") { bearerAuth(ana) }
                assertEquals(CollabCloseCode.UNAUTHENTICATED, closedWith())
            }
        }

    @Test
    fun `two clients edit together, and a reconnect brings offline edits`() =
        withServer { ws ->
            val ana = client.register("ana")
            val bo = client.register("bo")
            val id = client.newDocument(ana)
            client.share(ana, id, "bo", "editor")

            ws.docSocket(id, ana) {
                handshake()
                answerStateRequest(YProtocol.EMPTY_UPDATE)
                send(Frame.Binary(true, YProtocol.update(YjsFixtures.ana1)))
                send(Frame.Binary(true, YProtocol.update(YjsFixtures.ana2)))
                awaitHandled()

                // bo edited offline. It joins, gets ana's edits, and answers with its full state.
                ws.docSocket(id, bo) {
                    val replayed = handshake().map { it.toList() }
                    assertEquals(listOf(YjsFixtures.ana1.toList(), YjsFixtures.ana2.toList()), replayed)
                    answerStateRequest(YjsFixtures.boFull)
                }
                // ana receives bo's offline edit (inside its full state).
                assertContentEquals(YjsFixtures.boFull, expect<Message.Update>().update)
                send(Frame.Binary(true, YProtocol.update(YjsFixtures.ana3)))
                awaitHandled()
            }

            // A fresh client gets the compacted log: bo's snapshot, then ana's later edit.
            ws.docSocket(id, ana) {
                assertEquals(listOf(YjsFixtures.boFull.toList(), YjsFixtures.ana3.toList()), handshake().map { it.toList() })
            }
        }

    @Test
    fun `viewers can follow along but not write`() =
        withServer { ws ->
            val ana = client.register("ana")
            val cyToken = client.register("cy")
            val id = client.newDocument(ana)
            client.share(ana, id, "cy", "viewer")

            ws.docSocket(id, ana) {
                handshake()
                answerStateRequest(YProtocol.EMPTY_UPDATE)
                ws.docSocket(id, cyToken) {
                    handshake()
                    send(Frame.Binary(true, YProtocol.update(u(66))))
                    send(Frame.Binary(true, YProtocol.syncStep2(u(67))))
                    awaitHandled()
                }
                send(Frame.Binary(true, YProtocol.update(u(1))))
                awaitHandled()
            }
            ws.docSocket(id, ana) {
                assertEquals(listOf(listOf<Byte>(1)), handshake().map { it.toList() })
            }
        }

    @Test
    fun `answers awareness queries`() =
        withServer { ws ->
            val ana = client.register("ana")
            val id = client.newDocument(ana)
            ws.docSocket(id, ana) {
                handshake()
                val presence = YProtocol.awareness(listOf(YProtocol.AwarenessEntry(5, 1, """{"user":{"name":"ana"}}""")))
                send(Frame.Binary(true, presence))
                assertEquals(5, expect<Message.Awareness>().entries.single().clientId)
                send(Frame.Binary(true, u(YProtocol.MESSAGE_QUERY_AWARENESS)))
                assertIs<Message.Awareness>(expect<Message.Awareness>())
            }
        }
}
