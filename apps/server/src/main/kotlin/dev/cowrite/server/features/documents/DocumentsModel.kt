package dev.cowrite.server.features.documents

enum class Role(
    val wire: String,
) {
    OWNER("owner"),
    EDITOR("editor"),
    VIEWER("viewer"),
    ;

    val canWrite: Boolean get() = this != VIEWER

    companion object {
        fun fromWire(value: String): Role? = entries.firstOrNull { it.wire == value }
    }
}

/** A document as one user sees it: with that user's role. */
data class Document(
    val id: String,
    val title: String,
    val owner: String,
    val role: Role,
    val updatedAt: Long,
)

/** Whether a user may open a document, and how. */
sealed interface Access {
    data class Granted(
        val role: Role,
    ) : Access

    data object NotFound : Access

    data object Forbidden : Access
}

sealed interface CreateResult {
    data class Created(
        val document: Document,
    ) : CreateResult

    data class Invalid(
        val reason: String,
    ) : CreateResult
}

sealed interface InviteResult {
    data object Done : InviteResult

    data object NotFound : InviteResult

    data object Forbidden : InviteResult

    data object UnknownUser : InviteResult

    data class Invalid(
        val reason: String,
    ) : InviteResult
}
