package dev.cowrite.server

import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.authRoutes
import dev.cowrite.server.features.collab.CollabIntents
import dev.cowrite.server.features.collab.collabRoutes
import dev.cowrite.server.features.documents.DocumentsIntents
import dev.cowrite.server.features.documents.documentsRoutes
import dev.cowrite.server.features.health.HealthIntents
import dev.cowrite.server.features.health.healthRoutes
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.pingPeriod
import io.ktor.server.websocket.timeout
import kotlinx.serialization.json.Json
import kotlin.time.Duration.Companion.seconds

/** Every feature's intents, built once in [main] (or by a test) and handed to the routes. */
class Dependencies(
    val health: HealthIntents,
    val auth: AuthIntents,
    val documents: DocumentsIntents,
    val collab: CollabIntents,
)

/** Largest WebSocket frame accepted: a full document state on (re)connect. */
const val MAX_FRAME_BYTES = 32L * 1024 * 1024

fun Application.module(
    config: AppConfig,
    dependencies: Dependencies,
) {
    install(ContentNegotiation) { json(Json { explicitNulls = false }) }
    install(CORS) {
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
        config.corsAllowedHosts.forEach { allowHost(it, schemes = listOf("http", "https")) }
        // The packaged desktop app serves its renderer from app://co-write.
        allowHost("co-write", schemes = listOf("app"))
    }
    install(WebSockets) {
        pingPeriod = 20.seconds
        timeout = 45.seconds
        maxFrameSize = MAX_FRAME_BYTES
    }

    routing {
        healthRoutes(dependencies.health)
        authRoutes(dependencies.auth)
        documentsRoutes(dependencies.documents, dependencies.auth)
        collabRoutes(dependencies.collab, dependencies.documents, dependencies.auth)
    }
}
