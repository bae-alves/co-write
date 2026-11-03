package dev.cowrite.server.features.oauth

import dev.cowrite.server.FakeDatabase
import dev.cowrite.server.FakeOAuthProvider
import dev.cowrite.server.TEST_ORIGIN
import dev.cowrite.server.features.auth.TestKey
import dev.cowrite.server.features.auth.jsonField
import dev.cowrite.server.features.auth.login
import dev.cowrite.server.features.auth.postJson
import dev.cowrite.server.features.auth.register
import dev.cowrite.server.kit.Pkce
import dev.cowrite.server.module
import dev.cowrite.server.testConfig
import dev.cowrite.server.testDependencies
import io.ktor.client.HttpClient
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private const val VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
private val CHALLENGE = Pkce.challengeOf(VERIFIER)

class OAuthRoutesTest {
    private val db = FakeDatabase()
    private val provider = FakeOAuthProvider()

    private fun withServer(block: suspend ApplicationTestBuilder.(HttpClient) -> Unit) =
        testApplication {
            application { module(testConfig, testDependencies(db, provider = provider)) }
            block(createClient { followRedirects = false })
        }

    /** What the system browser does: `/start`, the provider's page (here: just the `state`), then `/callback`. */
    private suspend fun HttpClient.browse(
        providerCode: String,
        port: Int = 45_678,
        challenge: String = CHALLENGE,
        link: String? = null,
    ): HttpResponse {
        val start =
            get("/api/oauth/github/start?port=$port&code_challenge=$challenge" + (link?.let { "&link=$it" } ?: ""))
        assertEquals(HttpStatusCode.Found, start.status, start.bodyAsText())
        val state = Url(start.headers[HttpHeaders.Location]!!).parameters["state"]!!
        return get("/api/oauth/github/callback?code=$providerCode&state=$state")
    }

    private fun HttpResponse.loopback(): Url {
        assertEquals(HttpStatusCode.Found, status, "expected a redirect to the loopback listener")
        return Url(headers[HttpHeaders.Location]!!)
    }

    private suspend fun HttpClient.exchange(
        code: String,
        verifier: String = VERIFIER,
    ) = postJson("/api/oauth/exchange", """{"code":"$code","codeVerifier":"$verifier"}""")

    @Test
    fun `lists the configured providers`() =
        withServer { client ->
            val info = client.get("/api/instance").bodyAsText()
            assertTrue(info.contains(""""auth":"accounts""""))
            assertTrue(info.contains(""""id":"github""""))
        }

    @Test
    fun `signs in through the full flow, creating the account on first use`() =
        withServer { client ->
            val back = client.browse("1001:Octo-Cat").loopback()
            assertEquals("127.0.0.1", back.host)
            assertEquals(45_678, back.port)
            val code = back.parameters["code"]!!

            val signedIn = client.exchange(code)
            assertEquals(HttpStatusCode.OK, signedIn.status)
            assertEquals("octo-cat", signedIn.bodyAsText().jsonField("username"))
            val me = client.get("/api/auth/me") { bearerAuth(signedIn.bodyAsText().jsonField("token")) }
            assertEquals("""{"username":"octo-cat"}""", me.bodyAsText())

            // The same identity signs in to the same account.
            val again = client.exchange(client.browse("1001:renamed").loopback().parameters["code"]!!)
            assertEquals("octo-cat", again.bodyAsText().jsonField("username"))
            assertEquals(1, db.users.size)
        }

    @Test
    fun `makes a unique username when the provider login is taken`() =
        withServer { client ->
            client.register("octocat")
            val code = client.browse("2002:octocat").loopback().parameters["code"]!!
            val name = client.exchange(code).bodyAsText().jsonField("username")
            assertTrue(name.startsWith("octocat-") && name != "octocat", name)
        }

    @Test
    fun `the code is bound to the PKCE verifier and works once`() =
        withServer { client ->
            val code = client.browse("1:ana").loopback().parameters["code"]!!
            assertEquals(HttpStatusCode.Unauthorized, client.exchange(code, "x".repeat(43)).status)
            // The wrong attempt spent the code: even the right verifier is refused now.
            assertEquals(HttpStatusCode.Unauthorized, client.exchange(code).status)

            val second = client.browse("1:ana").loopback().parameters["code"]!!
            assertEquals(HttpStatusCode.OK, client.exchange(second).status)
            assertEquals(HttpStatusCode.Unauthorized, client.exchange(second).status)
        }

    @Test
    fun `codes expire`() {
        var now = 1_000_000L
        testApplication {
            application { module(testConfig, testDependencies(db, provider = provider, now = { now })) }
            val client = createClient { followRedirects = false }
            val code = client.browse("1:ana").loopback().parameters["code"]!!
            now += 61_000
            assertEquals(HttpStatusCode.Unauthorized, client.exchange(code).status)
        }
    }

    @Test
    fun `validates the start request`() =
        withServer { client ->
            assertEquals(HttpStatusCode.NotFound, client.get("/api/oauth/nope/start?port=45000&code_challenge=$CHALLENGE").status)
            assertEquals(HttpStatusCode.BadRequest, client.get("/api/oauth/github/start?code_challenge=$CHALLENGE").status)
            assertEquals(HttpStatusCode.BadRequest, client.get("/api/oauth/github/start?port=80&code_challenge=$CHALLENGE").status)
            assertEquals(HttpStatusCode.BadRequest, client.get("/api/oauth/github/start?port=45000").status)
            assertEquals(HttpStatusCode.BadRequest, client.get("/api/oauth/github/start?port=45000&code_challenge=short").status)
            assertEquals(HttpStatusCode.BadRequest, client.get("/api/oauth/github/start?port=45000&code_challenge=$CHALLENGE&link=forged").status)
        }

    @Test
    fun `a callback needs a live state, and works once`() =
        withServer { client ->
            assertEquals(HttpStatusCode.BadRequest, client.get("/api/oauth/github/callback?code=1:a&state=forged").status)
            val start = client.get("/api/oauth/github/start?port=45000&code_challenge=$CHALLENGE")
            val state = Url(start.headers[HttpHeaders.Location]!!).parameters["state"]!!
            assertEquals(HttpStatusCode.Found, client.get("/api/oauth/github/callback?code=1:a&state=$state").status)
            assertEquals(HttpStatusCode.BadRequest, client.get("/api/oauth/github/callback?code=1:a&state=$state").status)
        }

    @Test
    fun `tells the desktop when the provider refuses`() =
        withServer { client ->
            val start = client.get("/api/oauth/github/start?port=45000&code_challenge=$CHALLENGE")
            val state = Url(start.headers[HttpHeaders.Location]!!).parameters["state"]!!
            val denied = client.get("/api/oauth/github/callback?error=access_denied&state=$state").loopback()
            assertEquals("access_denied", denied.parameters["error"])

            provider.failWith = "boom"
            val failed = client.browse("1:ana").loopback()
            assertEquals("provider_error", failed.parameters["error"])
            assertTrue(db.users.isEmpty())
        }

    @Test
    fun `links a provider to the signed-in account instead of creating one`() =
        withServer { client ->
            val key = TestKey()
            val token = client.register("ana", key)
            val intent = client.postJson("/api/me/oauth/link-intent", "{}", token).bodyAsText().jsonField("intent")

            val code = client.browse("77:ana-on-github", link = intent).loopback().parameters["code"]!!
            // The one-time code signs in as the account that asked for the link.
            assertEquals("ana", client.exchange(code).bodyAsText().jsonField("username"))
            assertEquals(1, db.users.size)

            val linked = client.get("/api/me/oauth") { bearerAuth(token) }.bodyAsText()
            assertTrue(linked.contains("ana-on-github"))

            // The intent was spent.
            assertEquals(
                HttpStatusCode.BadRequest,
                client.get("/api/oauth/github/start?port=45000&code_challenge=$CHALLENGE&link=$intent").status,
            )
        }

    @Test
    fun `an identity cannot be linked to two accounts`() =
        withServer { client ->
            val ana = client.register("ana")
            val bo = client.register("bo")
            val first = client.postJson("/api/me/oauth/link-intent", "{}", ana).bodyAsText().jsonField("intent")
            client.browse("9:shared", link = first).loopback()
            val second = client.postJson("/api/me/oauth/link-intent", "{}", bo).bodyAsText().jsonField("intent")
            val refused = client.browse("9:shared", link = second).loopback()
            assertEquals("already_linked", refused.parameters["error"])
            assertNotNull(db.identities["github" to "9"])
            assertEquals(db.users.getValue("ana").id, db.identities.getValue("github" to "9").first)
        }

    @Test
    fun `unlinking keeps the last way to sign in`() =
        withServer { client ->
            val key = TestKey()
            val token = client.register("ana", key)
            val intent = client.postJson("/api/me/oauth/link-intent", "{}", token).bodyAsText().jsonField("intent")
            client.browse("5:ana", link = intent).loopback()

            // A key and a provider: either may go, but not both.
            assertEquals(HttpStatusCode.NoContent, client.delete("/api/me/oauth/github") { bearerAuth(token) }.status)
            assertEquals(HttpStatusCode.NotFound, client.delete("/api/me/oauth/github") { bearerAuth(token) }.status)

            val intent2 = client.postJson("/api/me/oauth/link-intent", "{}", token).bodyAsText().jsonField("intent")
            client.browse("5:ana", link = intent2).loopback()
            val keyId = client.get("/api/me/keys") { bearerAuth(token) }.bodyAsText().let { Regex("\"id\":(\\d+)").find(it)!!.groupValues[1] }
            assertEquals(HttpStatusCode.NoContent, client.delete("/api/me/keys/$keyId") { bearerAuth(token) }.status)
            // The key's session ended with it; the account still signs in through the provider.
            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/auth/me") { bearerAuth(token) }.status)
            val code = client.browse("5:ana").loopback().parameters["code"]!!
            val viaProvider = client.exchange(code).bodyAsText().jsonField("token")
            assertEquals(HttpStatusCode.Conflict, client.delete("/api/me/oauth/github") { bearerAuth(viaProvider) }.status)
            assertEquals(HttpStatusCode.Unauthorized, client.login("ana", key).status)
        }

    @Test
    fun `offers no OAuth routes without a provider`() =
        testApplication {
            application { module(testConfig, testDependencies(db, provider = null)) }
            assertEquals(HttpStatusCode.NotFound, client.get("/api/oauth/github/start?port=45000&code_challenge=$CHALLENGE").status)
            assertTrue(client.get("/api/instance").bodyAsText().contains(""""oauth":[]"""))
        }

    @Test
    fun `the callback URL handed to the provider is on this server`() =
        withServer { client ->
            val start = client.get("/api/oauth/github/start?port=45000&code_challenge=$CHALLENGE")
            val redirect = Url(start.headers[HttpHeaders.Location]!!).parameters["redirect_uri"]
            assertEquals("$TEST_ORIGIN/api/oauth/github/callback", redirect)
        }
}
