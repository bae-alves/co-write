package dev.cowrite.server

import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.authRoutes
import dev.cowrite.server.features.collab.CollabIntents
import dev.cowrite.server.features.collab.collabRoutes
import dev.cowrite.server.features.documents.DocumentsIntents
import dev.cowrite.server.features.documents.documentsRoutes
import dev.cowrite.server.features.health.HealthIntents
import dev.cowrite.server.features.health.healthRoutes
import dev.cowrite.server.features.instance.InstanceIntents
import dev.cowrite.server.features.instance.instanceRoutes
import dev.cowrite.server.features.oauth.OAuthIntents
import dev.cowrite.server.features.oauth.oauthRoutes
import dev.cowrite.server.features.tickets.TicketsIntents
import dev.cowrite.server.features.tickets.ticketsRoutes
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.plugins.forwardedheaders.XForwardedHeaders
import io.ktor.server.plugins.origin
import io.ktor.server.plugins.ratelimit.RateLimit
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.pingPeriod
import io.ktor.server.websocket.timeout
import kotlinx.serialization.json.Json
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/** Every feature's intents, built once in [main] (or by a test) and handed to the routes. */
class Dependencies(
    val health: HealthIntents,
    val instance: InstanceIntents,
    val auth: AuthIntents,
    val documents: DocumentsIntents,
    val collab: CollabIntents,
    val tickets: TicketsIntents,
    /** Null when no provider is configured (always, with `AUTH=none`). */
    val oauth: OAuthIntents? = null,
)

/** Largest WebSocket frame accepted: a full document state on (re)connect. */
const val MAX_FRAME_BYTES = 32L * 1024 * 1024

fun Application.module(
    config: AppConfig,
    dependencies: Dependencies,
) {
    install(ContentNegotiation) { json(Json { explicitNulls = false }) }
    // Behind a reverse proxy the client's address and scheme come from X-Forwarded-* headers.
    if (config.trustProxy) install(XForwardedHeaders)
    install(CORS) {
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
        config.corsAllowedHosts.forEach { allowHost(it, schemes = listOf("http", "https")) }
        // The packaged desktop app serves its renderer from app://co-write.
        allowHost("co-write", schemes = listOf("app"))
    }
    install(RateLimit) {
        register(AUTH_LIMIT) {
            rateLimiter(limit = config.rateLimitPerMinute, refillPeriod = 1.minutes)
            requestKey { call -> call.request.origin.remoteHost }
        }
    }
    install(WebSockets) {
        pingPeriod = 20.seconds
        timeout = 45.seconds
        maxFrameSize = MAX_FRAME_BYTES
    }

    val accounts = config.authMode == AuthMode.ACCOUNTS
    routing {
        healthRoutes(dependencies.health)
        instanceRoutes(dependencies.instance)
        if (accounts) {
            // With AUTH=none these answer 404: there are no accounts, tickets or providers.
            authRoutes(dependencies.auth) { serverOrigin(config) }
            ticketsRoutes(dependencies.tickets, dependencies.auth)
            dependencies.oauth?.let { oauthRoutes(it, dependencies.auth) { serverOrigin(config) } }
        }
        documentsRoutes(dependencies.documents, dependencies.auth, manageMembers = accounts)
        collabRoutes(dependencies.collab, dependencies.documents, dependencies.auth, dependencies.tickets)
    }
}
