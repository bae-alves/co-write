package dev.cowrite.server.features.tickets

import dev.cowrite.server.AUTH_LIMIT
import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.ErrorResponse
import dev.cowrite.server.features.auth.receiveOrBadRequest
import dev.cowrite.server.features.auth.requireUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.plugins.ratelimit.rateLimit
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable

@Serializable
data class TicketRequest(
    val docId: String,
)

@Serializable
data class TicketResponse(
    val ticket: String,
    val expiresAt: Long,
)

/** `POST /api/ws-ticket`. Only mounted when the instance has accounts. */
fun Route.ticketsRoutes(
    intents: TicketsIntents,
    auth: AuthIntents,
) {
    rateLimit(AUTH_LIMIT) {
        post("/api/ws-ticket") {
            val user = call.requireUser(auth) ?: return@post
            val body = call.receiveOrBadRequest<TicketRequest>() ?: return@post
            when (val result = intents.issue(user, body.docId)) {
                is IssueResult.Issued -> call.respond(TicketResponse(result.ticket.value, result.ticket.expiresAt))
                IssueResult.NotFound -> call.respond(HttpStatusCode.NotFound, ErrorResponse("No such document."))
                IssueResult.Forbidden -> call.respond(HttpStatusCode.Forbidden, ErrorResponse("No access to this document."))
            }
        }
    }
}
