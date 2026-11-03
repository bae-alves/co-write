package dev.cowrite.server.features.instance

import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import kotlinx.serialization.Serializable

@Serializable
data class OAuthProviderResponse(
    val id: String,
    val label: String,
)

@Serializable
data class InstanceResponse(
    val auth: String,
    val oauth: List<OAuthProviderResponse>,
    val version: String,
)

/** `GET /api/instance`: `{ auth: "none" | "accounts", oauth: [...] }`. Needs no sign-in. */
fun Route.instanceRoutes(intents: InstanceIntents) {
    get("/api/instance") {
        val info = intents.describe()
        call.respond(InstanceResponse(info.auth.wire, info.oauth.map { OAuthProviderResponse(it.id, it.label) }, info.version))
    }
}
