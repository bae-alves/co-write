package dev.cowrite.server.features.auth

import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable
data class AuthRequest(
    val username: String,
    val password: String,
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

private suspend fun ApplicationCall.respondAuth(result: AuthResult) =
    when (result) {
        is AuthResult.SignedIn -> respond(HttpStatusCode.OK, AuthResponse(result.user.username, result.token))
        is AuthResult.Invalid -> respond(HttpStatusCode.BadRequest, ErrorResponse(result.reason))
        AuthResult.WrongCredentials -> respond(HttpStatusCode.Unauthorized, ErrorResponse("Wrong username or password."))
        AuthResult.UsernameTaken -> respond(HttpStatusCode.Conflict, ErrorResponse("That username is taken."))
    }

fun Route.authRoutes(intents: AuthIntents) {
    route("/api/auth") {
        post("/register") {
            val body = call.receiveOrBadRequest<AuthRequest>() ?: return@post
            call.respondAuth(intents.register(body.username, body.password))
        }
        post("/login") {
            val body = call.receiveOrBadRequest<AuthRequest>() ?: return@post
            call.respondAuth(intents.login(body.username, body.password))
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
}
