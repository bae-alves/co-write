package dev.cowrite.server.features.collab

import dev.cowrite.server.FakeDatabase
import dev.cowrite.server.YjsFixtures
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
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
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

    @Test
    fun `refuses unauthenticated, unknown and foreign documents with terminal close codes`() =
        withServer { ws ->
            val ana = client.register("ana")
            val bo = client.register("bo")
            val id = client.newDocument(ana)
            assertEquals(CollabCloseCode.UNAUTHENTICATED, ws.closeCode("/ws/docs/$id"))
            assertEquals(CollabCloseCode.UNAUTHENTICATED, ws.closeCode("/ws/docs/$id?token=bogus"))
            assertEquals(CollabCloseCode.NOT_FOUND, ws.closeCode("/ws/docs/nope?token=$ana"))
            assertEquals(CollabCloseCode.FORBIDDEN, ws.closeCode("/ws/docs/$id?token=$bo"))
        }

    @Test
    fun `two clients edit together, and a reconnect brings offline edits`() =
        withServer { ws ->
            val ana = client.register("ana")
            val bo = client.register("bo")
            val id = client.newDocument(ana)
            client.share(ana, id, "bo", "editor")

            ws.webSocket("/ws/docs/$id?token=$ana") {
                handshake()
                answerStateRequest(YProtocol.EMPTY_UPDATE)
                send(Frame.Binary(true, YProtocol.update(YjsFixtures.ana1)))
                send(Frame.Binary(true, YProtocol.update(YjsFixtures.ana2)))

                // bo edited offline. It joins, gets ana's edits, and answers with its full state.
                ws.webSocket("/ws/docs/$id?token=$bo") {
                    val replayed = handshake().map { it.toList() }
                    assertEquals(listOf(YjsFixtures.ana1.toList(), YjsFixtures.ana2.toList()), replayed)
                    answerStateRequest(YjsFixtures.boFull)
                }
                // ana receives bo's offline edit (inside its full state).
                assertContentEquals(YjsFixtures.boFull, expect<Message.Update>().update)
                send(Frame.Binary(true, YProtocol.update(YjsFixtures.ana3)))
            }

            // A fresh client gets the compacted log: bo's snapshot, then ana's later edit.
            ws.webSocket("/ws/docs/$id?token=$ana") {
                assertEquals(listOf(YjsFixtures.boFull.toList(), YjsFixtures.ana3.toList()), handshake().map { it.toList() })
            }
        }

    @Test
    fun `viewers can follow along but not write`() =
        withServer { ws ->
            val ana = client.register("ana")
            client.register("cy")
            val cy = client.postJson("/api/auth/login", """{"username":"cy","password":"password1"}""").bodyAsText()
            val cyToken = Json.parseToJsonElement(cy).jsonObject["token"]!!.jsonPrimitive.content
            val id = client.newDocument(ana)
            client.share(ana, id, "cy", "viewer")

            ws.webSocket("/ws/docs/$id?token=$ana") {
                handshake()
                answerStateRequest(YProtocol.EMPTY_UPDATE)
                ws.webSocket("/ws/docs/$id?token=$cyToken") {
                    handshake()
                    send(Frame.Binary(true, YProtocol.update(u(66))))
                    send(Frame.Binary(true, YProtocol.syncStep2(u(67))))
                }
                send(Frame.Binary(true, YProtocol.update(u(1))))
            }
            ws.webSocket("/ws/docs/$id?token=$ana") {
                assertEquals(listOf(listOf<Byte>(1)), handshake().map { it.toList() })
            }
        }

    @Test
    fun `answers awareness queries`() =
        withServer { ws ->
            val ana = client.register("ana")
            val id = client.newDocument(ana)
            ws.webSocket("/ws/docs/$id?token=$ana") {
                handshake()
                val presence = YProtocol.awareness(listOf(YProtocol.AwarenessEntry(5, 1, """{"user":{"name":"ana"}}""")))
                send(Frame.Binary(true, presence))
                assertEquals(5, expect<Message.Awareness>().entries.single().clientId)
                send(Frame.Binary(true, u(YProtocol.MESSAGE_QUERY_AWARENESS)))
                assertIs<Message.Awareness>(expect<Message.Awareness>())
            }
        }
}
