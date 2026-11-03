package dev.cowrite.server.features.oauth

import dev.cowrite.server.AUTH_LIMIT
import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.ErrorResponse
import dev.cowrite.server.features.auth.receiveOrBadRequest
import dev.cowrite.server.features.auth.requireUser
import dev.cowrite.server.features.auth.respondAuth
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.ratelimit.rateLimit
import io.ktor.server.response.respond
import io.ktor.server.response.respondRedirect
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable
data class ExchangeRequest(
    val code: String,
    val codeVerifier: String,
)

@Serializable
data class LinkIntentResponse(
    val intent: String,
)

@Serializable
data class IdentityResponse(
    val provider: String,
    val login: String,
)

/** OAuth routes. Only mounted when the instance has accounts and at least one provider is configured. */
fun Route.oauthRoutes(
    intents: OAuthIntents,
    auth: AuthIntents,
    origin: ApplicationCall.() -> String,
) {
    route("/api/oauth") {
        rateLimit(AUTH_LIMIT) {
            get("/{provider}/start") {
                val provider = call.parameters["provider"].orEmpty()
                val params = call.request.queryParameters
                val callback = "${call.origin()}/api/oauth/$provider/callback"
                when (
                    val result =
                        intents.start(provider, params["port"]?.toIntOrNull(), params["code_challenge"], params["link"], callback)
                ) {
                    is StartResult.Redirect -> call.respondRedirect(result.url)
                    StartResult.UnknownProvider -> call.respond(HttpStatusCode.NotFound, ErrorResponse("No such provider."))
                    is StartResult.Invalid -> call.respond(HttpStatusCode.BadRequest, ErrorResponse(result.reason))
                }
            }
            get("/{provider}/callback") {
                val provider = call.parameters["provider"].orEmpty()
                val params = call.request.queryParameters
                val callback = "${call.origin()}/api/oauth/$provider/callback"
                when (val result = intents.callback(provider, params["code"], params["state"], params["error"], callback)) {
                    is CallbackResult.Redirect -> call.respondRedirect(result.url)
                    is CallbackResult.Failed -> call.respondText(result.message, ContentType.Text.Plain, HttpStatusCode.BadRequest)
                }
            }
            post("/exchange") {
                val body = call.receiveOrBadRequest<ExchangeRequest>() ?: return@post
                call.respondAuth(intents.exchange(body.code, body.codeVerifier))
            }
        }
    }
    route("/api/me/oauth") {
        get {
            val user = call.requireUser(auth) ?: return@get
            call.respond(intents.identities(user).map { IdentityResponse(it.provider, it.login) })
        }
        post("/link-intent") {
            val user = call.requireUser(auth) ?: return@post
            call.respond(LinkIntentResponse(intents.linkIntent(user)))
        }
        delete("/{provider}") {
            val user = call.requireUser(auth) ?: return@delete
            when (intents.unlink(user, call.parameters["provider"].orEmpty())) {
                UnlinkResult.Done -> call.respond(HttpStatusCode.NoContent)
                UnlinkResult.NotFound -> call.respond(HttpStatusCode.NotFound, ErrorResponse("That provider is not linked."))
                UnlinkResult.LastMethod ->
                    call.respond(
                        HttpStatusCode.Conflict,
                        ErrorResponse("That is your only way to sign in. Add a key or link another provider first."),
                    )
            }
        }
    }
}
