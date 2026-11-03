package dev.cowrite.server.features.instance

import dev.cowrite.server.AppConfig
import dev.cowrite.server.AuthMode
import dev.cowrite.server.FakeDatabase
import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.jsonField
import dev.cowrite.server.features.auth.postJson
import dev.cowrite.server.module
import dev.cowrite.server.testConfig
import dev.cowrite.server.testDependencies
import io.ktor.client.request.get
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class InstanceAndOpenModeTest {
    private val db = FakeDatabase()
    private val openConfig = testConfig.copy(authMode = AuthMode.NONE)

    private fun withOpenServer(block: suspend ApplicationTestBuilder.() -> Unit) =
        testApplication {
            application { module(openConfig, testDependencies(db, mode = AuthMode.NONE, provider = null)) }
            block()
        }

    @Test
    fun `an instance with accounts says so`() =
        testApplication {
            application { module(testConfig, testDependencies(db)) }
            val info = Json.parseToJsonElement(client.get("/api/instance").bodyAsText()).jsonObject
            assertEquals("accounts", info["auth"]!!.jsonPrimitive.content)
            assertEquals("github", info["oauth"]!!.jsonArray.single().jsonObject["id"]!!.jsonPrimitive.content)
        }

    @Test
    fun `an open instance says none and offers no accounts`() =
        withOpenServer {
            val info = Json.parseToJsonElement(client.get("/api/instance").bodyAsText()).jsonObject
            assertEquals("none", info["auth"]!!.jsonPrimitive.content)
            assertEquals(0, info["oauth"]!!.jsonArray.size)
            // Accounts-only routes are not there.
            assertEquals(HttpStatusCode.NotFound, client.postJson("/api/auth/challenge", "{}").status)
            assertEquals(HttpStatusCode.NotFound, client.get("/api/auth/me").status)
            assertEquals(HttpStatusCode.NotFound, client.postJson("/api/ws-ticket", """{"docId":"x"}""").status)
            assertEquals(HttpStatusCode.NotFound, client.get("/api/me/keys").status)
            assertEquals(HttpStatusCode.NotFound, client.get("/api/oauth/github/start").status)
        }

    @Test
    fun `everyone can create and list documents without signing in, as an editor`() =
        withOpenServer {
            val created = client.postJson("/api/docs", """{"title":"Shared notes"}""")
            assertEquals(HttpStatusCode.Created, created.status)
            assertEquals("editor", created.bodyAsText().jsonField("role"))
            val list = Json.parseToJsonElement(client.get("/api/docs").bodyAsText()).jsonArray
            assertEquals(listOf("Shared notes"), list.map { it.jsonObject["title"]!!.jsonPrimitive.content })
            assertEquals(listOf("editor"), list.map { it.jsonObject["role"]!!.jsonPrimitive.content })
            assertEquals(AuthIntents.OPEN_USERNAME, db.users.keys.single())
        }

    @Test
    fun `there are no members or owners to manage`() =
        withOpenServer {
            val id = client.postJson("/api/docs", """{"title":"Doc"}""").bodyAsText().jsonField("id")
            val invite =
                client.put("/api/docs/$id/members") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"username":"bo","role":"viewer"}""")
                }
            assertEquals(HttpStatusCode.NotFound, invite.status)
        }

    @Test
    fun `the built-in user cannot be registered by name`() {
        // '@' is not a legal username character, so no account can take it.
        assertTrue(!Regex("^[a-z0-9_.-]{2,32}$").matches(AuthIntents.OPEN_USERNAME))
    }

    @Test
    fun `reads AUTH from the environment and refuses nonsense`() {
        assertEquals(AuthMode.ACCOUNTS, AppConfig.fromEnv(emptyMap()).authMode)
        assertEquals(AuthMode.NONE, AppConfig.fromEnv(mapOf("AUTH" to "NONE")).authMode)
        assertFailsWith<IllegalArgumentException> { AppConfig.fromEnv(mapOf("AUTH" to "maybe")) }
    }

    @Test
    fun `configures OAuth providers from the environment, never with AUTH=none`() {
        val env =
            mapOf(
                "OAUTH_GITHUB_CLIENT_ID" to "id",
                "OAUTH_GITHUB_CLIENT_SECRET" to "secret",
                "OAUTH_OIDC_ISSUER" to "https://sso.example.com/",
                "OAUTH_OIDC_CLIENT_ID" to "id2",
                "OAUTH_OIDC_CLIENT_SECRET" to "secret2",
                "OAUTH_OIDC_NAME" to "Acme SSO",
            )
        val config = AppConfig.fromEnv(env)
        assertEquals(listOf("github", "oidc"), config.oauth.map { it.id })
        assertEquals("Acme SSO", config.oauth.last().label)
        assertEquals("https://sso.example.com", config.oauth.last().issuer)
        assertEquals(emptyList(), AppConfig.fromEnv(env + ("AUTH" to "none")).oauth)
        // A half-configured provider stays hidden.
        assertEquals(emptyList(), AppConfig.fromEnv(mapOf("OAUTH_GITHUB_CLIENT_ID" to "id")).oauth)
    }
}
