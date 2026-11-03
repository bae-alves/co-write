package dev.cowrite.server.features.auth

import dev.cowrite.server.AUTH_LIMIT
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.ratelimit.rateLimit
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable
data class ChallengeResponse(
    val nonce: String,
    val expiresAt: Long,
)

@Serializable
data class RegisterRequest(
    val username: String,
    val publicKey: String,
    val nonce: String,
    val signature: String,
)

@Serializable
data class LoginRequest(
    val username: String,
    val nonce: String,
    val signature: String,
)

@Serializable
data class AuthResponse(
    val username: String,
    val token: String,
)

@Serializable
data class MeResponse(
    val username: String,
)

@Serializable
data class KeyResponse(
    val id: Long,
    val fingerprint: String,
    val label: String,
    val createdAt: Long,
)

@Serializable
data class AddKeyRequest(
    val publicKey: String,
    val label: String = "",
)

@Serializable
data class ErrorResponse(
    val error: String,
)

fun ApplicationCall.bearerToken(): String? =
    request.headers[HttpHeaders.Authorization]
        ?.takeIf { it.startsWith("Bearer ", ignoreCase = true) }
        ?.substring("Bearer ".length)
        ?.trim()

/** Resolves the caller from the bearer token, or answers 401 and returns null. */
suspend fun ApplicationCall.requireUser(auth: AuthIntents): User? {
    val user = auth.authenticate(bearerToken())
    if (user == null) respond(HttpStatusCode.Unauthorized, ErrorResponse("Sign in first."))
    return user
}

/** Parses the JSON body, or answers 400 and returns null. */
suspend inline fun <reified T : Any> ApplicationCall.receiveOrBadRequest(): T? =
    try {
        receive<T>()
    } catch (e: Exception) {
        respond(HttpStatusCode.BadRequest, ErrorResponse("Malformed request body."))
        null
    }

private fun StoredKey.toResponse() = KeyResponse(id, fingerprint, label, createdAt)

suspend fun ApplicationCall.respondAuth(result: AuthResult) =
    when (result) {
        is AuthResult.SignedIn -> respond(HttpStatusCode.OK, AuthResponse(result.user.username, result.token))
        is AuthResult.Invalid -> respond(HttpStatusCode.BadRequest, ErrorResponse(result.reason))
        is AuthResult.Rejected -> respond(HttpStatusCode.Unauthorized, ErrorResponse(result.reason))
        AuthResult.UsernameTaken -> respond(HttpStatusCode.Conflict, ErrorResponse("That username is taken."))
        AuthResult.KeyTaken -> respond(HttpStatusCode.Conflict, ErrorResponse("That key already belongs to an account."))
    }

/** Account routes. Only mounted when the instance has accounts (`AUTH=accounts`). */
fun Route.authRoutes(
    intents: AuthIntents,
    origin: ApplicationCall.() -> String,
) {
    route("/api/auth") {
        rateLimit(AUTH_LIMIT) {
            post("/challenge") {
                val challenge = intents.issueChallenge()
                call.respond(ChallengeResponse(challenge.nonce, challenge.expiresAt))
            }
            post("/register") {
                val body = call.receiveOrBadRequest<RegisterRequest>() ?: return@post
                call.respondAuth(intents.register(call.origin(), body.username, body.publicKey, body.nonce, body.signature))
            }
            post("/login") {
                val body = call.receiveOrBadRequest<LoginRequest>() ?: return@post
                call.respondAuth(intents.login(call.origin(), body.username, body.nonce, body.signature))
            }
        }
        post("/logout") {
            call.bearerToken()?.let { intents.logout(it) }
            call.respond(HttpStatusCode.NoContent)
        }
        get("/me") {
            val user = call.requireUser(intents) ?: return@get
            call.respond(MeResponse(user.username))
        }
    }
    route("/api/me") {
        // Deleting the account removes its keys, OAuth links, sessions, memberships and the
        // documents it owns. The desktop lists those documents before asking.
        delete {
            val user = call.requireUser(intents) ?: return@delete
            intents.deleteAccount(user)
            call.respond(HttpStatusCode.NoContent)
        }
        route("/keys") {
            get {
                val user = call.requireUser(intents) ?: return@get
                call.respond(intents.keys(user).map { it.toResponse() })
            }
            post {
                val user = call.requireUser(intents) ?: return@post
                val body = call.receiveOrBadRequest<AddKeyRequest>() ?: return@post
                when (val result = intents.addKey(user, body.publicKey, body.label)) {
                    is AddKeyResult.Added -> call.respond(HttpStatusCode.Created, result.key.toResponse())
                    is AddKeyResult.Invalid -> call.respond(HttpStatusCode.BadRequest, ErrorResponse(result.reason))
                    AddKeyResult.Duplicate -> call.respond(HttpStatusCode.Conflict, ErrorResponse("That key is already registered."))
                }
            }
            delete("/{id}") {
                val user = call.requireUser(intents) ?: return@delete
                val id = call.parameters["id"]?.toLongOrNull()
                if (id == null) {
                    call.respond(HttpStatusCode.NotFound, ErrorResponse("No such key."))
                    return@delete
                }
                when (intents.removeKey(user, id)) {
                    RemoveKeyResult.Removed -> call.respond(HttpStatusCode.NoContent)
                    RemoveKeyResult.NotFound -> call.respond(HttpStatusCode.NotFound, ErrorResponse("No such key."))
                    RemoveKeyResult.LastMethod ->
                        call.respond(
                            HttpStatusCode.Conflict,
                            ErrorResponse("That is your only way to sign in. Add another key or link a provider first."),
                        )
                }
            }
        }
    }
}
