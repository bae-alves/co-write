package dev.cowrite.server.features.auth

import dev.cowrite.server.FakeDatabase
import dev.cowrite.server.module
import dev.cowrite.server.testConfig
import dev.cowrite.server.testDependencies
import io.ktor.client.HttpClient
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

suspend fun HttpClient.postJson(
    path: String,
    body: String,
    token: String? = null,
): HttpResponse =
    post(path) {
        contentType(ContentType.Application.Json)
        token?.let { bearerAuth(it) }
        setBody(body)
    }

/** Registers `username` and returns its session token. */
suspend fun HttpClient.register(username: String): String {
    val response = postJson("/api/auth/register", """{"username":"$username","password":"password1"}""")
    check(response.status == HttpStatusCode.OK) { response.bodyAsText() }
    return Json.parseToJsonElement(response.bodyAsText()).jsonObject["token"]!!.jsonPrimitive.content
}

private fun withServer(
    db: FakeDatabase = FakeDatabase(),
    block: suspend ApplicationTestBuilder.() -> Unit,
) = testApplication {
    application { module(testConfig, testDependencies(db)) }
    block()
}

class AuthRoutesTest {
    @Test
    fun `registers, then the token identifies the user`() =
        withServer {
            val token = client.register("Ana")
            val me = client.get("/api/auth/me") { bearerAuth(token) }
            assertEquals(HttpStatusCode.OK, me.status)
            assertEquals("""{"username":"ana"}""", me.bodyAsText())
        }

    @Test
    fun `stores only hashes of passwords and tokens`() {
        val db = FakeDatabase()
        withServer(db) {
            val token = client.register("ana")
            assertFalse(db.users.getValue("ana").passwordHash.contains("password1"))
            assertTrue(db.sessions.keys.none { it.contains(token) })
        }
    }

    @Test
    fun `refuses a taken username, case-insensitively`() =
        withServer {
            client.register("ana")
            val again = client.postJson("/api/auth/register", """{"username":"ANA","password":"password2"}""")
            assertEquals(HttpStatusCode.Conflict, again.status)
        }

    @Test
    fun `validates usernames and passwords`() =
        withServer {
            val shortName = client.postJson("/api/auth/register", """{"username":"a","password":"password1"}""")
            assertEquals(HttpStatusCode.BadRequest, shortName.status)
            val shortPassword = client.postJson("/api/auth/register", """{"username":"ana","password":"short"}""")
            assertEquals(HttpStatusCode.BadRequest, shortPassword.status)
            val garbage = client.postJson("/api/auth/register", """{"user":1}""")
            assertEquals(HttpStatusCode.BadRequest, garbage.status)
        }

    @Test
    fun `logs in with the right password only`() =
        withServer {
            client.register("ana")
            val ok = client.postJson("/api/auth/login", """{"username":"ana","password":"password1"}""")
            assertEquals(HttpStatusCode.OK, ok.status)
            val wrong = client.postJson("/api/auth/login", """{"username":"ana","password":"password2"}""")
            assertEquals(HttpStatusCode.Unauthorized, wrong.status)
            val unknown = client.postJson("/api/auth/login", """{"username":"bo","password":"password1"}""")
            assertEquals(HttpStatusCode.Unauthorized, unknown.status)
            assertEquals(wrong.bodyAsText(), unknown.bodyAsText())
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
        val auth = AuthIntents(db.auth, now = { now }, hashPassword = { dev.cowrite.server.kit.Secrets.hashPassword(it, 1_000) })
        kotlinx.coroutines.runBlocking {
            val result = auth.register("ana", "password1") as AuthResult.SignedIn
            assertEquals("ana", auth.authenticate(result.token)?.username)
            now += 31L * 24 * 60 * 60 * 1000
            assertEquals(null, auth.authenticate(result.token))
        }
    }
}
