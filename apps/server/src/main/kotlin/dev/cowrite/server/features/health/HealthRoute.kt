package dev.cowrite.server.features.health

import io.ktor.http.HttpStatusCode
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import kotlinx.serialization.Serializable

@Serializable
data class HealthResponse(
    val status: String,
    val version: String,
    val reason: String? = null,
)

/** The route is the server's "view": passive. It fires the intent and renders the resulting state. */
fun Route.healthRoutes(intents: HealthIntents) {
    get("/health") {
        when (val state = intents.check()) {
            is HealthState.Up ->
                call.respond(HttpStatusCode.OK, HealthResponse("up", state.version))
            is HealthState.Degraded ->
                call.respond(
                    HttpStatusCode.ServiceUnavailable,
                    HealthResponse("degraded", state.version, state.reason),
                )
        }
    }
}
