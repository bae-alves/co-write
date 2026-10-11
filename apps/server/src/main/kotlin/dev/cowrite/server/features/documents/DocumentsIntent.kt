package dev.cowrite.server.features.documents

import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.User
import dev.cowrite.server.kit.Secrets

/** Document identity and permissions. Knows nothing about content; that is the collab feature. */
class DocumentsIntents(
    private val repository: DocumentsRepository,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { Secrets.randomId(16) },
) {
    companion object {
        const val MAX_TITLE = 200
        private val ID = Regex("^[A-Za-z0-9_-]{1,64}$")
    }

    suspend fun list(user: User): List<Document> = repository.listFor(user.id)

    suspend fun create(
        user: User,
        rawTitle: String,
    ): CreateResult {
        val title = rawTitle.trim()
        if (title.isEmpty() || title.length > MAX_TITLE) {
            return CreateResult.Invalid("Titles are 1–$MAX_TITLE characters.")
        }
        return CreateResult.Created(repository.create(newId(), title, user.id, now()))
    }

    /** Members get their role; everyone else is told the document does not exist or is not theirs. */
    suspend fun access(
        user: User,
        documentId: String,
    ): Access {
        if (!ID.matches(documentId)) return Access.NotFound
        repository.roleOf(documentId, user.id)?.let { return Access.Granted(it) }
        return if (repository.exists(documentId)) Access.Forbidden else Access.NotFound
    }

    /** Only the owner may add members or change their roles; the owner's own role is fixed. */
    suspend fun invite(
        user: User,
        documentId: String,
        rawUsername: String,
        roleName: String,
    ): InviteResult {
        val role = Role.fromWire(roleName)
        if (role == null || role == Role.OWNER) return InviteResult.Invalid("Role must be editor or viewer.")
        when (val access = access(user, documentId)) {
            Access.NotFound -> return InviteResult.NotFound
            Access.Forbidden -> return InviteResult.NotFound
            is Access.Granted -> if (access.role != Role.OWNER) return InviteResult.Forbidden
        }
        val username = AuthIntents.normalize(rawUsername)
        if (username == user.username) return InviteResult.Invalid("You already own this document.")
        val memberId = repository.userIdOf(username) ?: return InviteResult.UnknownUser
        repository.setMember(documentId, memberId, role)
        return InviteResult.Done
    }
}
