package dev.cowrite.server.features.tickets

import dev.cowrite.server.features.auth.User
import dev.cowrite.server.features.documents.Access
import dev.cowrite.server.features.documents.DocumentsIntents
import dev.cowrite.server.kit.Secrets
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * WebSocket tickets: an authenticated request for one document returns a ticket that is valid once
 * and for 30 seconds. The socket connects with `?ticket=`, so the session token never appears in a
 * URL (and so never in a proxy's access log).
 */
class TicketsIntents(
    private val repository: TicketsRepository,
    private val documents: DocumentsIntents,
    private val now: () -> Long = System::currentTimeMillis,
    private val lifetime: Duration = 30.seconds,
) {
    suspend fun issue(
        user: User,
        documentId: String,
    ): IssueResult {
        when (documents.access(user, documentId)) {
            Access.NotFound -> return IssueResult.NotFound
            Access.Forbidden -> return IssueResult.Forbidden
            is Access.Granted -> Unit
        }
        val value = Secrets.randomId(32)
        val expiresAt = now() + lifetime.inWholeMilliseconds
        repository.save(Secrets.hashToken(value), user.id, documentId, expiresAt, now())
        return IssueResult.Issued(Ticket(value, expiresAt))
    }

    /** The user the ticket was issued to, if it is valid for this document. It cannot be used again. */
    suspend fun redeem(
        ticket: String?,
        documentId: String,
    ): User? {
        if (ticket.isNullOrBlank() || ticket.length > 128) return null
        return repository.redeem(Secrets.hashToken(ticket), documentId, now())
    }
}
