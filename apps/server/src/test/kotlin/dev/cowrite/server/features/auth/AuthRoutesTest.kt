package dev.cowrite.server.features.auth

import dev.cowrite.server.AppConfig
import dev.cowrite.server.FakeDatabase
import dev.cowrite.server.TEST_ORIGIN
import dev.cowrite.server.kit.SignedMessages
import dev.cowrite.server.module
import dev.cowrite.server.testConfig
import dev.cowrite.server.testDependencies
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

private fun withServer(
    db: FakeDatabase = FakeDatabase(),
    config: AppConfig = testConfig,
    block: suspend ApplicationTestBuilder.() -> Unit,
) = testApplication {
    application { module(config, testDependencies(db)) }
    block()
}

private fun quoted(text: String) = Json.encodeToString(String.serializer(), text)

class AuthRoutesTest {
    @Test
    fun `registers with a signed challenge, then the token identifies the user`() =
        withServer {
            val token = client.register("Ana")
            val me = client.get("/api/auth/me") { bearerAuth(token) }
            assertEquals(HttpStatusCode.OK, me.status)
            assertEquals("""{"username":"ana"}""", me.bodyAsText())
        }

    @Test
    fun `stores only hashes of tokens and nonces, and no password anywhere`() {
        val db = FakeDatabase()
        withServer(db) {
            val token = client.register("ana")
            assertTrue(db.sessions.keys.none { it.contains(token) })
            assertTrue(db.challenges.isEmpty(), "the challenge is spent by registering")
            assertEquals(1, db.keys.size)
        }
    }

    @Test
    fun `a challenge works once`() =
        withServer {
            val key = TestKey()
            val nonce = client.challenge()
            val body =
                """{"username":"ana","publicKey":${quoted(key.pem)},"nonce":"$nonce","signature":"${key.sign(SignedMessages.register(TEST_ORIGIN, nonce, "ana"))}"}"""
            assertEquals(HttpStatusCode.OK, client.postJson("/api/auth/register", body).status)
            val replay = client.postJson("/api/auth/register", body.replace("\"ana\"", "\"bo\""))
            assertEquals(HttpStatusCode.Unauthorized, replay.status)
        }

    @Test
    fun `rejects expired, unknown and foreign-origin signatures`() {
        val db = FakeDatabase()
        var now = 1_000_000L
        testApplication {
            application { module(testConfig, testDependencies(db, now = { now })) }
            val key = TestKey()
            fun body(
                nonce: String,
                signed: String,
            ) = """{"username":"ana","publicKey":${quoted(key.pem)},"nonce":"$nonce","signature":"$signed"}"""

            // Expired: more than 60 s old.
            val old = client.challenge()
            now += 61_000
            assertEquals(
                HttpStatusCode.Unauthorized,
                client.postJson("/api/auth/register", body(old, key.sign(SignedMessages.register(TEST_ORIGIN, old, "ana")))).status,
            )
            // Unknown nonce.
            assertEquals(
                HttpStatusCode.Unauthorized,
                client.postJson("/api/auth/register", body("made-up", key.sign(SignedMessages.register(TEST_ORIGIN, "made-up", "ana")))).status,
            )
            // Signed for another server (a replay against this one).
            val fresh = client.challenge()
            assertEquals(
                HttpStatusCode.Unauthorized,
                client
                    .postJson(
                        "/api/auth/register",
                        body(fresh, key.sign(SignedMessages.register("https://evil.example", fresh, "ana"))),
                    ).status,
            )
            // A login signature cannot be used to register, and vice versa.
            val third = client.challenge()
            assertEquals(
                HttpStatusCode.Unauthorized,
                client.postJson("/api/auth/register", body(third, key.sign(SignedMessages.login(TEST_ORIGIN, third)))).status,
            )
            assertTrue(db.users.isEmpty())
        }
    }

    @Test
    fun `refuses a taken username, case-insensitively, and a key that is already registered`() =
        withServer {
            val key = TestKey()
            client.register("ana", key)
            val nonce = client.challenge()
            val taken =
                client.postJson(
                    "/api/auth/register",
                    """{"username":"ANA","publicKey":${quoted(TestKey().pem)},"nonce":"$nonce","signature":"${TestKey().sign("x")}"}""",
                )
            // A wrong signature is reported before the name is: nothing is learned about existing accounts.
            assertEquals(HttpStatusCode.Unauthorized, taken.status)

            val other = TestKey()
            val second = client.challenge()
            val duplicateName =
                client.postJson(
                    "/api/auth/register",
                    """{"username":"ANA","publicKey":${quoted(other.pem)},"nonce":"$second","signature":"${other.sign(SignedMessages.register(TEST_ORIGIN, second, "ana"))}"}""",
                )
            assertEquals(HttpStatusCode.Conflict, duplicateName.status)

            val third = client.challenge()
            val duplicateKey =
                client.postJson(
                    "/api/auth/register",
                    """{"username":"bo","publicKey":${quoted(key.pem)},"nonce":"$third","signature":"${key.sign(SignedMessages.register(TEST_ORIGIN, third, "bo"))}"}""",
                )
            assertEquals(HttpStatusCode.Conflict, duplicateKey.status)
        }

    @Test
    fun `validates usernames and keys`() =
        withServer {
            val key = TestKey()
            val shortName = client.postJson("/api/auth/register", """{"username":"a","publicKey":${quoted(key.pem)},"nonce":"n","signature":"s"}""")
            assertEquals(HttpStatusCode.BadRequest, shortName.status)
            val notAKey = client.postJson("/api/auth/register", """{"username":"ana","publicKey":"hello","nonce":"n","signature":"s"}""")
            assertEquals(HttpStatusCode.BadRequest, notAKey.status)
            val rsa =
                java.security.KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair().public.encoded
            val rsaPem = "-----BEGIN PUBLIC KEY-----\n${java.util.Base64.getMimeEncoder().encodeToString(rsa)}\n-----END PUBLIC KEY-----"
            val wrongAlgorithm = client.postJson("/api/auth/register", """{"username":"ana","publicKey":${quoted(rsaPem)},"nonce":"n","signature":"s"}""")
            assertEquals(HttpStatusCode.BadRequest, wrongAlgorithm.status)
            assertTrue(wrongAlgorithm.bodyAsText().contains("Ed25519"))
            val garbage = client.postJson("/api/auth/register", """{"user":1}""")
            assertEquals(HttpStatusCode.BadRequest, garbage.status)
        }

    @Test
    fun `signs in with any of the account's keys, and not with others`() =
        withServer {
            val laptop = TestKey()
            val token = client.register("ana", laptop)
            val desktop = TestKey()
            assertEquals(
                HttpStatusCode.Created,
                client.postJson("/api/me/keys", """{"publicKey":${quoted(desktop.pem)},"label":"desktop"}""", token).status,
            )

            assertEquals(HttpStatusCode.OK, client.login("ana", laptop).status)
            assertEquals(HttpStatusCode.OK, client.login("Ana", desktop).status)
            val stranger = client.login("ana", TestKey())
            val unknownUser = client.login("nobody", TestKey())
            assertEquals(HttpStatusCode.Unauthorized, stranger.status)
            assertEquals(HttpStatusCode.Unauthorized, unknownUser.status)
            assertEquals(stranger.bodyAsText(), unknownUser.bodyAsText(), "does not reveal which names exist")
        }

    @Test
    fun `a login signature cannot be replayed against another server or reused`() =
        withServer {
            val key = TestKey()
            client.register("ana", key)
            assertEquals(HttpStatusCode.Unauthorized, client.login("ana", key, origin = "https://evil.example").status)
            val nonce = client.challenge()
            val body = """{"username":"ana","nonce":"$nonce","signature":"${key.sign(SignedMessages.login(TEST_ORIGIN, nonce))}"}"""
            assertEquals(HttpStatusCode.OK, client.postJson("/api/auth/login", body).status)
            assertEquals(HttpStatusCode.Unauthorized, client.postJson("/api/auth/login", body).status)
        }

    @Test
    fun `lists keys, and removing one ends the sessions made with it`() =
        withServer {
            val laptop = TestKey()
            val laptopToken = client.register("ana", laptop)
            val desktop = TestKey()
            client.postJson("/api/me/keys", """{"publicKey":${quoted(desktop.pem)},"label":"  desktop  "}""", laptopToken)
            val desktopToken = client.login("ana", desktop).bodyAsText().jsonField("token")

            val keys = Json.parseToJsonElement(client.get("/api/me/keys") { bearerAuth(laptopToken) }.bodyAsText()).jsonArray
            assertEquals(listOf("", "desktop"), keys.map { it.jsonObject["label"]!!.jsonPrimitive.content })
            assertTrue(keys.all { it.jsonObject["fingerprint"]!!.jsonPrimitive.content.startsWith("SHA256:") })
            val desktopKeyId = keys.last().jsonObject["id"]!!.jsonPrimitive.content

            assertEquals(HttpStatusCode.NoContent, client.delete("/api/me/keys/$desktopKeyId") { bearerAuth(laptopToken) }.status)
            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/auth/me") { bearerAuth(desktopToken) }.status)
            assertEquals(HttpStatusCode.OK, client.get("/api/auth/me") { bearerAuth(laptopToken) }.status)
            assertEquals(HttpStatusCode.Unauthorized, client.login("ana", desktop).status)
        }

    @Test
    fun `the last way to sign in cannot be removed`() =
        withServer {
            val token = client.register("ana")
            val keys = Json.parseToJsonElement(client.get("/api/me/keys") { bearerAuth(token) }.bodyAsText()).jsonArray
            val id = keys.single().jsonObject["id"]!!.jsonPrimitive.content
            assertEquals(HttpStatusCode.Conflict, client.delete("/api/me/keys/$id") { bearerAuth(token) }.status)
            assertEquals(HttpStatusCode.NotFound, client.delete("/api/me/keys/999") { bearerAuth(token) }.status)
        }

    @Test
    fun `refuses a key that belongs to another account`() =
        withServer {
            val shared = TestKey()
            client.register("ana", shared)
            val bo = client.register("bo")
            assertEquals(
                HttpStatusCode.Conflict,
                client.postJson("/api/me/keys", """{"publicKey":${quoted(shared.pem)}}""", bo).status,
            )
        }

    @Test
    fun `deleting the account removes its keys, sessions and documents`() {
        val db = FakeDatabase()
        withServer(db) {
            val token = client.register("ana")
            client.postJson("/api/docs", """{"title":"Mine"}""", token)
            assertEquals(HttpStatusCode.NoContent, client.delete("/api/me") { bearerAuth(token) }.status)
            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/auth/me") { bearerAuth(token) }.status)
            assertTrue(db.users.isEmpty() && db.keys.isEmpty() && db.documents.isEmpty() && db.members.isEmpty())
        }
    }

    @Test
    fun `logout ends the session`() =
        withServer {
            val token = client.register("ana")
            client.post("/api/auth/logout") { bearerAuth(token) }
            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/auth/me") { bearerAuth(token) }.status)
        }

    @Test
    fun `rejects missing and bogus tokens`() =
        withServer {
            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/auth/me").status)
            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/auth/me") { bearerAuth("nope") }.status)
            val basic = client.get("/api/auth/me") { header(HttpHeaders.Authorization, "Basic YTpi") }
            assertEquals(HttpStatusCode.Unauthorized, basic.status)
        }

    @Test
    fun `expired sessions are rejected`() {
        val db = FakeDatabase()
        var now = 1_000L
        val auth = AuthIntents(db.auth, now = { now })
        runBlocking {
            val key = TestKey()
            val nonce = auth.issueChallenge().nonce
            val result =
                auth.register(TEST_ORIGIN, "ana", key.pem, nonce, key.sign(SignedMessages.register(TEST_ORIGIN, nonce, "ana"))) as AuthResult.SignedIn
            assertEquals("ana", auth.authenticate(result.token)?.username)
            now += 31L * 24 * 60 * 60 * 1000
            assertEquals(null, auth.authenticate(result.token))
        }
    }

    @Test
    fun `derives the origin from the request when PUBLIC_URL is unset`() =
        withServer(config = AppConfig.fromEnv(emptyMap())) {
            val key = TestKey()
            client.register("ana", key, origin = "http://localhost")
            assertEquals(HttpStatusCode.OK, client.login("ana", key, origin = "http://localhost").status)
            assertNotEquals(HttpStatusCode.OK, client.login("ana", key, origin = TEST_ORIGIN).status)
        }

    @Test
    fun `rate limits the sign-in endpoints per client`() =
        withServer(config = testConfig.copy(rateLimitPerMinute = 3)) {
            repeat(3) { assertEquals(HttpStatusCode.OK, client.postJson("/api/auth/challenge", "{}").status) }
            val limited = client.postJson("/api/auth/challenge", "{}")
            assertEquals(HttpStatusCode.TooManyRequests, limited.status)
            assertFalse(limited.headers[HttpHeaders.RetryAfter].isNullOrEmpty())
            // Everything else is not limited.
            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/auth/me").status)
        }
}
