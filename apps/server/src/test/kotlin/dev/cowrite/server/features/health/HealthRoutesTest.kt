package dev.cowrite.server.features.health

import dev.cowrite.server.AppConfig
import dev.cowrite.server.module
import dev.cowrite.server.testDependencies
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private val config = AppConfig.fromEnv(emptyMap())

private class FakeHealthRepository(
    private val failure: Exception? = null,
) : HealthRepository {
    override suspend fun pingDatabase() {
        failure?.let { throw it }
    }
}

private fun withServer(
    repository: HealthRepository,
    block: suspend io.ktor.server.testing.ApplicationTestBuilder.() -> Unit,
) = testApplication {
    application {
        val base = testDependencies()
        module(config, dev.cowrite.server.Dependencies(HealthIntents(repository, "1.2.3"), base.auth, base.documents, base.collab))
    }
    block()
}

class HealthRoutesTest {
    @Test
    fun `reports up when the database answers`() =
        withServer(FakeHealthRepository()) {
            val response = client.get("/health")
            assertEquals(HttpStatusCode.OK, response.status)
            assertEquals("""{"status":"up","version":"1.2.3"}""", response.bodyAsText())
        }

    @Test
    fun `reports degraded with 503 when the database is unreachable`() =
        withServer(FakeHealthRepository(RuntimeException("connection refused"))) {
            val response = client.get("/health")
            assertEquals(HttpStatusCode.ServiceUnavailable, response.status)
            assertEquals(
                """{"status":"degraded","version":"1.2.3","reason":"connection refused"}""",
                response.bodyAsText(),
            )
        }

    @Test
    fun `allows the dev renderer origin via CORS`() =
        withServer(FakeHealthRepository()) {
            val response = client.get("/health") { header(HttpHeaders.Origin, "http://localhost:5173") }
            assertEquals("http://localhost:5173", response.headers[HttpHeaders.AccessControlAllowOrigin])
        }

    @Test
    fun `allows the packaged desktop app via CORS`() =
        withServer(FakeHealthRepository()) {
            val response = client.get("/health") { header(HttpHeaders.Origin, "app://co-write") }
            assertEquals("app://co-write", response.headers[HttpHeaders.AccessControlAllowOrigin])
        }

    @Test
    fun `does not allow file pages (Origin null) via CORS`() =
        withServer(FakeHealthRepository()) {
            val response = client.get("/health") { header(HttpHeaders.Origin, "null") }
            assertNull(response.headers[HttpHeaders.AccessControlAllowOrigin])
        }

    @Test
    fun `does not allow other origins via CORS`() =
        withServer(FakeHealthRepository()) {
            val response = client.get("/health") { header(HttpHeaders.Origin, "http://evil.example") }
            assertNull(response.headers[HttpHeaders.AccessControlAllowOrigin])
        }
}
