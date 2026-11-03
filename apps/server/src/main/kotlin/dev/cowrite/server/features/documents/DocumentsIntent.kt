package dev.cowrite.server.features.documents

import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.User
import dev.cowrite.server.kit.Secrets

/** Document identity and permissions. Knows nothing about content; that is the collab feature. */
class DocumentsIntents(
    private val repository: DocumentsRepository,
    /** `AUTH=none`: every document is open to everyone as an editor; there are no members or owners to manage. */
    private val open: Boolean = false,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { Secrets.randomId(16) },
    /** Called after a member's role changed or they were removed, e.g. to close their open sockets. */
    private val onMemberChanged: suspend (documentId: String, userId: Long, removed: Boolean) -> Unit = { _, _, _ -> },
) {
    companion object {
        const val MAX_TITLE = 200
        private val ID = Regex("^[A-Za-z0-9_-]{1,64}$")
    }

    private fun Document.visible() = if (open) copy(role = Role.EDITOR) else this

    suspend fun list(user: User): List<Document> =
        if (open) repository.listAll() else repository.listFor(user.id)

    suspend fun create(
        user: User,
        rawTitle: String,
    ): CreateResult {
        val title = rawTitle.trim()
        if (title.isEmpty() || title.length > MAX_TITLE) {
            return CreateResult.Invalid("Titles are 1–$MAX_TITLE characters.")
        }
        return CreateResult.Created(repository.create(newId(), title, user.id, now()).visible())
    }

    /** Members get their role; everyone else is told the document does not exist or is not theirs. */
    suspend fun access(
        user: User,
        documentId: String,
    ): Access {
        if (!ID.matches(documentId)) return Access.NotFound
        if (open) return if (repository.exists(documentId)) Access.Granted(Role.EDITOR) else Access.NotFound
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
        if (open) return InviteResult.NotFound
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
        onMemberChanged(documentId, memberId, false)
        return InviteResult.Done
    }

    /** Only the owner removes members; the owner cannot be removed. */
    suspend fun removeMember(
        user: User,
        documentId: String,
        rawUsername: String,
    ): RemoveMemberResult {
        if (open) return RemoveMemberResult.NotFound
        when (val access = access(user, documentId)) {
            Access.NotFound, Access.Forbidden -> return RemoveMemberResult.NotFound
            is Access.Granted -> if (access.role != Role.OWNER) return RemoveMemberResult.Forbidden
        }
        val username = AuthIntents.normalize(rawUsername)
        if (username == user.username) return RemoveMemberResult.Invalid("The owner cannot be removed. Transfer ownership first.")
        val memberId = repository.userIdOf(username) ?: return RemoveMemberResult.NotFound
        if (!repository.removeMember(documentId, memberId)) return RemoveMemberResult.NotFound
        onMemberChanged(documentId, memberId, true)
        return RemoveMemberResult.Done
    }

    /** Hands the document to another user, who becomes its owner; the old owner stays an editor. */
    suspend fun transferOwnership(
        user: User,
        documentId: String,
        rawUsername: String,
    ): TransferResult {
        if (open) return TransferResult.NotFound
        when (val access = access(user, documentId)) {
            Access.NotFound, Access.Forbidden -> return TransferResult.NotFound
            is Access.Granted -> if (access.role != Role.OWNER) return TransferResult.Forbidden
        }
        val username = AuthIntents.normalize(rawUsername)
        if (username == user.username) return TransferResult.Invalid("You already own this document.")
        val newOwner = repository.userIdOf(username) ?: return TransferResult.UnknownUser
        repository.transferOwnership(documentId, user.id, newOwner)
        onMemberChanged(documentId, newOwner, false)
        onMemberChanged(documentId, user.id, false)
        return TransferResult.Done
    }
}
