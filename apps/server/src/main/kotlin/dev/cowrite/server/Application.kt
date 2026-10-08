package dev.cowrite.server

import dev.cowrite.server.features.health.HealthIntents
import dev.cowrite.server.features.health.healthRoutes
import io.ktor.http.HttpMethod
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json

/** Every feature's intents, built once in [main] (or by a test) and handed to the routes. */
class Dependencies(
    val health: HealthIntents,
)

fun Application.module(
    config: AppConfig,
    dependencies: Dependencies,
) {
    install(ContentNegotiation) { json(Json { explicitNulls = false }) }
    install(CORS) {
        allowMethod(HttpMethod.Get)
        config.corsAllowedHosts.forEach { allowHost(it, schemes = listOf("http", "https")) }
    }

    routing {
        healthRoutes(dependencies.health)
    }
}
