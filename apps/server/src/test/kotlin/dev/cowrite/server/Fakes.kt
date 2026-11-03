package dev.cowrite.server

import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.AuthRepository
import dev.cowrite.server.features.auth.CreateUserOutcome
import dev.cowrite.server.features.auth.NewKey
import dev.cowrite.server.features.auth.StoredKey
import dev.cowrite.server.features.auth.User
import dev.cowrite.server.features.collab.CollabCloseCode
import dev.cowrite.server.features.collab.CollabIntents
import dev.cowrite.server.features.collab.CollabRepository
import dev.cowrite.server.features.collab.StoredUpdate
import dev.cowrite.server.features.documents.Document
import dev.cowrite.server.features.documents.DocumentsIntents
import dev.cowrite.server.features.documents.DocumentsRepository
import dev.cowrite.server.features.documents.Role
import dev.cowrite.server.features.health.HealthIntents
import dev.cowrite.server.features.health.HealthRepository
import dev.cowrite.server.features.instance.InstanceInfo
import dev.cowrite.server.features.instance.InstanceIntents
import dev.cowrite.server.features.instance.OAuthProviderInfo
import dev.cowrite.server.features.oauth.Flow
import dev.cowrite.server.features.oauth.OAuthFailure
import dev.cowrite.server.features.oauth.OAuthIdentity
import dev.cowrite.server.features.oauth.OAuthIntents
import dev.cowrite.server.features.oauth.OAuthProviderClient
import dev.cowrite.server.features.oauth.OAuthRepository
import dev.cowrite.server.features.oauth.StoredCode
import dev.cowrite.server.features.tickets.TicketsIntents
import dev.cowrite.server.features.tickets.TicketsRepository
import java.util.HexFormat
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

private fun hex(bytes: ByteArray) = HexFormat.of().formatHex(bytes)

/** In-memory stand-ins for the JDBC repositories, sharing one fake "database" (with its cascades). */
class FakeDatabase {
    class Session(
        val userId: Long,
        val keyId: Long?,
        val expiresAt: Long,
    )

    val users = ConcurrentHashMap<String, User>()
    val keys = CopyOnWriteArrayList<Pair<Long, StoredKey>>() // (userId, key)
    val challenges = ConcurrentHashMap<String, Long>() // hex(nonceHash) → expiresAt
    val sessions = ConcurrentHashMap<String, Session>() // hex(tokenHash) → session
    val documents = ConcurrentHashMap<String, Triple<String, Long, Long>>() // id → (title, ownerId, updatedAt)
    val members = ConcurrentHashMap<Pair<String, Long>, Role>()
    val updates = ConcurrentHashMap<String, MutableList<StoredUpdate>>()
    val tickets = ConcurrentHashMap<String, Triple<Long, String, Long>>() // hex(hash) → (userId, documentId, expiresAt)
    val identities = ConcurrentHashMap<Pair<String, String>, Pair<Long, String>>() // (provider, subject) → (userId, login)
    val linkIntents = ConcurrentHashMap<String, Pair<Long, Long>>() // hex(hash) → (userId, expiresAt)
    val flows = ConcurrentHashMap<String, Pair<Flow, Long>>() // hex(stateHash) → (flow, expiresAt)
    val codes = ConcurrentHashMap<String, Triple<Long, String, Long>>() // hex(codeHash) → (userId, challenge, expiresAt)
    private var nextUserId = 1L
    private var nextKeyId = 1L

    fun userById(id: Long) = users.values.first { it.id == id }

    val auth =
        object : AuthRepository {
            override suspend fun createUser(
                username: String,
                key: NewKey?,
            ): CreateUserOutcome =
                synchronized(users) {
                    if (users.containsKey(username)) return CreateUserOutcome.UsernameTaken
                    if (key != null && keys.any { it.second.publicKey.contentEquals(key.publicKey) }) return CreateUserOutcome.KeyTaken
                    val user = User(nextUserId++, username)
                    users[username] = user
                    val keyId = key?.let { addKeyRow(user.id, it, 0) }?.id
                    CreateUserOutcome.Created(user, keyId)
                }

            override suspend fun findUser(username: String) = users[username]

            override suspend fun keysOf(userId: Long) = keys.filter { it.first == userId }.map { it.second }

            override suspend fun addKey(
                userId: Long,
                key: NewKey,
                now: Long,
            ): StoredKey? =
                synchronized(users) {
                    if (keys.any { it.second.publicKey.contentEquals(key.publicKey) }) null else addKeyRow(userId, key, now)
                }

            override suspend fun removeKey(
                userId: Long,
                keyId: Long,
            ): Boolean {
                val removed = keys.removeIf { it.first == userId && it.second.id == keyId }
                sessions.entries.removeIf { it.value.keyId == keyId } // ON DELETE CASCADE
                return removed
            }

            override suspend fun signInMethodCount(userId: Long) =
                keys.count { it.first == userId } + identities.values.count { it.first == userId }

            override suspend fun saveChallenge(
                nonceHash: ByteArray,
                expiresAt: Long,
                now: Long,
            ) {
                challenges.entries.removeIf { it.value <= now }
                challenges[hex(nonceHash)] = expiresAt
            }

            override suspend fun consumeChallenge(
                nonceHash: ByteArray,
                now: Long,
            ): Boolean {
                val expiresAt = challenges.remove(hex(nonceHash)) ?: return false
                return expiresAt > now
            }

            override suspend fun createSession(
                tokenHash: ByteArray,
                userId: Long,
                keyId: Long?,
                expiresAt: Long,
            ) {
                sessions[hex(tokenHash)] = Session(userId, keyId, expiresAt)
            }

            override suspend fun findSession(
                tokenHash: ByteArray,
                now: Long,
            ): User? {
                val session = sessions[hex(tokenHash)] ?: return null
                return if (session.expiresAt > now) userById(session.userId) else null
            }

            override suspend fun deleteSession(tokenHash: ByteArray) {
                sessions.remove(hex(tokenHash))
            }

            override suspend fun deleteUser(userId: Long) {
                users.values.removeIf { it.id == userId }
                keys.removeIf { it.first == userId }
                sessions.entries.removeIf { it.value.userId == userId }
                identities.entries.removeIf { it.value.first == userId }
                tickets.entries.removeIf { it.value.first == userId }
                members.keys.removeIf { it.second == userId }
                documents.entries.filter { it.value.second == userId }.forEach {
                    documents.remove(it.key)
                    members.keys.removeIf { member -> member.first == it.key }
                    updates.remove(it.key)
                }
            }
        }

    private fun addKeyRow(
        userId: Long,
        key: NewKey,
        now: Long,
    ): StoredKey {
        val stored = StoredKey(nextKeyId++, key.publicKey, key.fingerprint, key.label, now)
        keys += userId to stored
        return stored
    }

    val docs =
        object : DocumentsRepository {
            override suspend fun create(
                id: String,
                title: String,
                ownerId: Long,
                now: Long,
            ): Document {
                documents[id] = Triple(title, ownerId, now)
                members[id to ownerId] = Role.OWNER
                return Document(id, title, userById(ownerId).username, Role.OWNER, now)
            }

            override suspend fun listFor(userId: Long) =
                members.entries
                    .filter { it.key.second == userId }
                    .map { (key, role) ->
                        val (title, ownerId, updatedAt) = documents.getValue(key.first)
                        Document(key.first, title, userById(ownerId).username, role, updatedAt)
                    }.sortedByDescending { it.updatedAt }

            override suspend fun exists(documentId: String) = documents.containsKey(documentId)

            override suspend fun roleOf(
                documentId: String,
                userId: Long,
            ) = members[documentId to userId]

            override suspend fun setMember(
                documentId: String,
                userId: Long,
                role: Role,
            ) {
                members[documentId to userId] = role
            }

            override suspend fun userIdOf(username: String) = users[username]?.id

            override suspend fun listAll() =
                documents.entries
                    .map { (id, value) -> Document(id, value.first, userById(value.second).username, Role.EDITOR, value.third) }
                    .sortedByDescending { it.updatedAt }

            override suspend fun removeMember(
                documentId: String,
                userId: Long,
            ): Boolean {
                val role = members[documentId to userId] ?: return false
                if (role == Role.OWNER) return false
                return members.remove(documentId to userId) != null
            }

            override suspend fun transferOwnership(
                documentId: String,
                fromUserId: Long,
                toUserId: Long,
            ) {
                val (title, _, updatedAt) = documents.getValue(documentId)
                documents[documentId] = Triple(title, toUserId, updatedAt)
                members[documentId to fromUserId] = Role.EDITOR
                members[documentId to toUserId] = Role.OWNER
            }
        }

    val collab =
        object : CollabRepository {
            override suspend fun load(documentId: String) = synchronized(updates) { updates[documentId].orEmpty().sortedBy { it.seq } }

            override suspend fun append(
                documentId: String,
                seq: Long,
                data: ByteArray,
                now: Long,
            ) {
                synchronized(updates) {
                    val log = updates.getOrPut(documentId) { mutableListOf() }
                    check(log.none { it.seq == seq }) { "duplicate seq $seq" }
                    log += StoredUpdate(seq, data)
                }
            }

            override suspend fun compact(
                documentId: String,
                upTo: Long,
                snapshot: ByteArray,
            ) {
                synchronized(updates) {
                    val log = updates.getOrPut(documentId) { mutableListOf() }
                    log.removeAll { it.seq <= upTo }
                    log += StoredUpdate(upTo, snapshot)
                }
            }
        }

    val ticketsRepository =
        object : TicketsRepository {
            override suspend fun save(
                ticketHash: ByteArray,
                userId: Long,
                documentId: String,
                expiresAt: Long,
                now: Long,
            ) {
                tickets.entries.removeIf { it.value.third <= now }
                tickets[hex(ticketHash)] = Triple(userId, documentId, expiresAt)
            }

            override suspend fun redeem(
                ticketHash: ByteArray,
                documentId: String,
                now: Long,
            ): User? {
                val (userId, document, expiresAt) = tickets.remove(hex(ticketHash)) ?: return null
                return if (expiresAt > now && document == documentId) userById(userId) else null
            }
        }

    val oauth =
        object : OAuthRepository {
            override suspend fun saveLinkIntent(
                intentHash: ByteArray,
                userId: Long,
                expiresAt: Long,
                now: Long,
            ) {
                linkIntents[hex(intentHash)] = userId to expiresAt
            }

            override suspend fun consumeLinkIntent(
                intentHash: ByteArray,
                now: Long,
            ): Long? = linkIntents.remove(hex(intentHash))?.takeIf { it.second > now }?.first

            override suspend fun saveFlow(
                stateHash: ByteArray,
                flow: Flow,
                expiresAt: Long,
                now: Long,
            ) {
                flows[hex(stateHash)] = flow to expiresAt
            }

            override suspend fun consumeFlow(
                stateHash: ByteArray,
                now: Long,
            ): Flow? = flows.remove(hex(stateHash))?.takeIf { it.second > now }?.first

            override suspend fun saveCode(
                codeHash: ByteArray,
                userId: Long,
                codeChallenge: String,
                expiresAt: Long,
                now: Long,
            ) {
                codes[hex(codeHash)] = Triple(userId, codeChallenge, expiresAt)
            }

            override suspend fun consumeCode(
                codeHash: ByteArray,
                now: Long,
            ): StoredCode? {
                val (userId, challenge, expiresAt) = codes.remove(hex(codeHash)) ?: return null
                return if (expiresAt > now) StoredCode(this@FakeDatabase.userById(userId), challenge) else null
            }

            override suspend fun userById(userId: Long) = users.values.firstOrNull { it.id == userId }

            override suspend fun findIdentity(
                provider: String,
                subject: String,
            ) = identities[provider to subject]?.let { userById(it.first) }

            override suspend fun linkIdentity(
                userId: Long,
                identity: OAuthIdentity,
            ): Boolean = identities.putIfAbsent(identity.provider to identity.subject, userId to identity.login) == null

            override suspend fun identitiesOf(userId: Long) =
                identities.entries
                    .filter { it.value.first == userId }
                    .map { OAuthIdentity(it.key.first, it.key.second, it.value.second) }

            override suspend fun unlink(
                userId: Long,
                provider: String,
            ) = identities.entries.removeIf { it.key.first == provider && it.value.first == userId }
        }
}

/**
 * A provider that trusts the "authorization code" it is given: `code = "<subject>:<login>"`.
 * `failWith` makes the code exchange fail as if the provider had refused it.
 */
class FakeOAuthProvider : OAuthProviderClient {
    @Volatile var failWith: String? = null

    override fun providers() = listOf(OAuthProviderInfo("github", "GitHub"))

    override suspend fun authorizeUrl(
        providerId: String,
        state: String,
        redirectUri: String,
    ): String? = if (providerId == "github") "https://provider.test/authorize?state=$state&redirect_uri=$redirectUri" else null

    override suspend fun fetchIdentity(
        providerId: String,
        code: String,
        redirectUri: String,
    ): OAuthIdentity {
        failWith?.let { throw OAuthFailure(it) }
        val parts = code.split(':', limit = 2)
        return OAuthIdentity(providerId, parts[0], parts.getOrElse(1) { parts[0] })
    }
}

const val TEST_ORIGIN = "https://co-write.test"

val testConfig = AppConfig.fromEnv(mapOf("PUBLIC_URL" to TEST_ORIGIN))

fun testDependencies(
    db: FakeDatabase = FakeDatabase(),
    compactAfter: Int = 200,
    mode: AuthMode = AuthMode.ACCOUNTS,
    provider: OAuthProviderClient? = FakeOAuthProvider(),
    now: () -> Long = System::currentTimeMillis,
): Dependencies {
    val collab = CollabIntents(db.collab, compactAfter = compactAfter)
    val documents =
        DocumentsIntents(
            db.docs,
            open = mode == AuthMode.NONE,
            now = now,
            onMemberChanged = { documentId, userId, removed ->
                collab.disconnect(
                    userId,
                    if (removed) CollabCloseCode.FORBIDDEN else CollabCloseCode.ROLE_CHANGED,
                    "membership changed",
                    documentId,
                )
            },
        )
    val auth =
        AuthIntents(
            db.auth,
            mode = mode,
            now = now,
            onAccountDeleted = { collab.disconnect(it.id, CollabCloseCode.UNAUTHENTICATED, "Account deleted.") },
        )
    return Dependencies(
        health =
            HealthIntents(
                object : HealthRepository {
                    override suspend fun pingDatabase() {}
                },
                "test",
            ),
        instance =
            InstanceIntents(InstanceInfo(mode, provider?.providers().orEmpty(), "test")),
        auth = auth,
        documents = documents,
        collab = collab,
        tickets = TicketsIntents(db.ticketsRepository, documents, now = now),
        oauth = provider?.let { OAuthIntents(db.oauth, it, auth, now = now) },
    )
}
