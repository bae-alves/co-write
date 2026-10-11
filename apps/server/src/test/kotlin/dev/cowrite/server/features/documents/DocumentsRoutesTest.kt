package dev.cowrite.server.features.documents

import dev.cowrite.server.features.auth.postJson
import dev.cowrite.server.features.auth.register
import dev.cowrite.server.module
import dev.cowrite.server.testConfig
import dev.cowrite.server.testDependencies
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DocumentsRoutesTest {
    private fun json(text: String) = Json.parseToJsonElement(text)

    private fun withServer(block: suspend io.ktor.server.testing.ApplicationTestBuilder.() -> Unit) =
        testApplication {
            application { module(testConfig, testDependencies()) }
            block()
        }

    private suspend fun io.ktor.client.HttpClient.invite(
        token: String,
        id: String,
        body: String,
    ) = put("/api/docs/$id/members") {
        bearerAuth(token)
        contentType(ContentType.Application.Json)
        setBody(body)
    }

    @Test
    fun `needs a session`() =
        withServer {
            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/docs").status)
        }

    @Test
    fun `creates a document owned by the caller and lists it`() =
        withServer {
            val ana = client.register("ana")
            val created = client.postJson("/api/docs", """{"title":"  Plan  "}""", ana)
            assertEquals(HttpStatusCode.Created, created.status)
            val doc = json(created.bodyAsText()).jsonObject
            assertEquals("Plan", doc["title"]!!.jsonPrimitive.content)
            assertEquals("owner", doc["role"]!!.jsonPrimitive.content)
            assertTrue(Regex("^[A-Za-z0-9_-]{22}$").matches(doc["id"]!!.jsonPrimitive.content))

            val list = json(client.get("/api/docs") { bearerAuth(ana) }.bodyAsText()).jsonArray
            assertEquals(1, list.size)
        }

    @Test
    fun `rejects empty titles`() =
        withServer {
            val ana = client.register("ana")
            assertEquals(HttpStatusCode.BadRequest, client.postJson("/api/docs", """{"title":" "}""", ana).status)
        }

    @Test
    fun `others do not see a document until invited`() =
        withServer {
            val ana = client.register("ana")
            val bo = client.register("bo")
            val id = json(client.postJson("/api/docs", """{"title":"Plan"}""", ana).bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content
            assertEquals("[]", client.get("/api/docs") { bearerAuth(bo) }.bodyAsText())

            assertEquals(HttpStatusCode.NoContent, client.invite(ana, id, """{"username":"BO","role":"viewer"}""").status)
            val shared = json(client.get("/api/docs") { bearerAuth(bo) }.bodyAsText()).jsonArray.single().jsonObject
            assertEquals("viewer", shared["role"]!!.jsonPrimitive.content)
            assertEquals("ana", shared["owner"]!!.jsonPrimitive.content)

            assertEquals(HttpStatusCode.NoContent, client.invite(ana, id, """{"username":"bo","role":"editor"}""").status)
            val upgraded = json(client.get("/api/docs") { bearerAuth(bo) }.bodyAsText()).jsonArray.single().jsonObject
            assertEquals("editor", upgraded["role"]!!.jsonPrimitive.content)
        }

    @Test
    fun `only the owner can invite, and only as editor or viewer`() =
        withServer {
            val ana = client.register("ana")
            val bo = client.register("bo")
            client.register("cy")
            val id = json(client.postJson("/api/docs", """{"title":"Plan"}""", ana).bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content

            // Not a member: the document might as well not exist.
            assertEquals(HttpStatusCode.NotFound, client.invite(bo, id, """{"username":"cy","role":"editor"}""").status)
            client.invite(ana, id, """{"username":"bo","role":"editor"}""")
            assertEquals(HttpStatusCode.Forbidden, client.invite(bo, id, """{"username":"cy","role":"editor"}""").status)

            assertEquals(HttpStatusCode.BadRequest, client.invite(ana, id, """{"username":"cy","role":"owner"}""").status)
            assertEquals(HttpStatusCode.BadRequest, client.invite(ana, id, """{"username":"ana","role":"viewer"}""").status)
            assertEquals(HttpStatusCode.NotFound, client.invite(ana, id, """{"username":"nobody","role":"viewer"}""").status)
            assertEquals(HttpStatusCode.NotFound, client.invite(ana, "missing", """{"username":"cy","role":"viewer"}""").status)
        }
}
