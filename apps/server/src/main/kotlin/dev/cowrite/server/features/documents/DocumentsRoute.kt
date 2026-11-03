package dev.cowrite.server.features.documents

import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.ErrorResponse
import dev.cowrite.server.features.auth.receiveOrBadRequest
import dev.cowrite.server.features.auth.requireUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable
data class DocumentResponse(
    val id: String,
    val title: String,
    val owner: String,
    val role: String,
    val updatedAt: Long,
)

@Serializable
data class CreateDocumentRequest(
    val title: String,
)

@Serializable
data class MemberRequest(
    val username: String,
    val role: String,
)

@Serializable
data class OwnerRequest(
    val username: String,
)

private fun Document.toResponse() = DocumentResponse(id, title, owner, role.wire, updatedAt)

/** Document routes. With `manageMembers` off (`AUTH=none`) the member and owner routes are not mounted. */
fun Route.documentsRoutes(
    intents: DocumentsIntents,
    auth: AuthIntents,
    manageMembers: Boolean = true,
) {
    route("/api/docs") {
        get {
            val user = call.requireUser(auth) ?: return@get
            call.respond(intents.list(user).map { it.toResponse() })
        }
        post {
            val user = call.requireUser(auth) ?: return@post
            val body = call.receiveOrBadRequest<CreateDocumentRequest>() ?: return@post
            when (val result = intents.create(user, body.title)) {
                is CreateResult.Created -> call.respond(HttpStatusCode.Created, result.document.toResponse())
                is CreateResult.Invalid -> call.respond(HttpStatusCode.BadRequest, ErrorResponse(result.reason))
            }
        }
        if (manageMembers) put("/{id}/members") {
            val user = call.requireUser(auth) ?: return@put
            val body = call.receiveOrBadRequest<MemberRequest>() ?: return@put
            val id = call.parameters["id"].orEmpty()
            when (val result = intents.invite(user, id, body.username, body.role)) {
                InviteResult.Done -> call.respond(HttpStatusCode.NoContent)
                InviteResult.NotFound -> call.respond(HttpStatusCode.NotFound, ErrorResponse("No such document."))
                InviteResult.Forbidden ->
                    call.respond(HttpStatusCode.Forbidden, ErrorResponse("Only the owner can share this document."))
                InviteResult.UnknownUser -> call.respond(HttpStatusCode.NotFound, ErrorResponse("No user with that name."))
                is InviteResult.Invalid -> call.respond(HttpStatusCode.BadRequest, ErrorResponse(result.reason))
            }
        }
        if (manageMembers) {
            delete("/{id}/members/{username}") {
                val user = call.requireUser(auth) ?: return@delete
                val id = call.parameters["id"].orEmpty()
                val member = call.parameters["username"].orEmpty()
                when (val result = intents.removeMember(user, id, member)) {
                    RemoveMemberResult.Done -> call.respond(HttpStatusCode.NoContent)
                    RemoveMemberResult.NotFound -> call.respond(HttpStatusCode.NotFound, ErrorResponse("No such member."))
                    RemoveMemberResult.Forbidden ->
                        call.respond(HttpStatusCode.Forbidden, ErrorResponse("Only the owner can remove members."))
                    is RemoveMemberResult.Invalid -> call.respond(HttpStatusCode.BadRequest, ErrorResponse(result.reason))
                }
            }
            put("/{id}/owner") {
                val user = call.requireUser(auth) ?: return@put
                val body = call.receiveOrBadRequest<OwnerRequest>() ?: return@put
                val id = call.parameters["id"].orEmpty()
                when (val result = intents.transferOwnership(user, id, body.username)) {
                    TransferResult.Done -> call.respond(HttpStatusCode.NoContent)
                    TransferResult.NotFound -> call.respond(HttpStatusCode.NotFound, ErrorResponse("No such document."))
                    TransferResult.Forbidden ->
                        call.respond(HttpStatusCode.Forbidden, ErrorResponse("Only the owner can transfer this document."))
                    TransferResult.UnknownUser -> call.respond(HttpStatusCode.NotFound, ErrorResponse("No user with that name."))
                    is TransferResult.Invalid -> call.respond(HttpStatusCode.BadRequest, ErrorResponse(result.reason))
                }
            }
        }
    }
}
