package dev.cowrite.server.features.tickets

/** A single-use permission to open one document's WebSocket. */
data class Ticket(
    val value: String,
    val expiresAt: Long,
)

sealed interface IssueResult {
    data class Issued(
        val ticket: Ticket,
    ) : IssueResult

    data object NotFound : IssueResult

    data object Forbidden : IssueResult
}
