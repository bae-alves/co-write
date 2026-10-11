package dev.cowrite.server

import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.AuthRepository
import dev.cowrite.server.features.auth.StoredUser
import dev.cowrite.server.features.auth.User
import dev.cowrite.server.features.collab.CollabIntents
import dev.cowrite.server.features.collab.CollabRepository
import dev.cowrite.server.features.collab.StoredUpdate
import dev.cowrite.server.features.documents.Document
import dev.cowrite.server.features.documents.DocumentsIntents
import dev.cowrite.server.features.documents.DocumentsRepository
import dev.cowrite.server.features.documents.Role
import dev.cowrite.server.features.health.HealthIntents
import dev.cowrite.server.features.health.HealthRepository
import dev.cowrite.server.kit.Secrets
import java.util.concurrent.ConcurrentHashMap

/** In-memory stand-ins for the JDBC repositories, sharing one fake "database". */
class FakeDatabase {
    val users = ConcurrentHashMap<String, StoredUser>()
    val sessions = ConcurrentHashMap<String, Pair<Long, Long>>() // hex(tokenHash) → (userId, expiresAt)
    val documents = ConcurrentHashMap<String, Triple<String, Long, Long>>() // id → (title, ownerId, updatedAt)
    val members = ConcurrentHashMap<Pair<String, Long>, Role>()
    val updates = ConcurrentHashMap<String, MutableList<StoredUpdate>>()
    private var nextUserId = 1L

    fun userById(id: Long) = users.values.first { it.user.id == id }.user

    val auth =
        object : AuthRepository {
            override suspend fun createUser(
                username: String,
                passwordHash: String,
            ): User? =
                synchronized(users) {
                    if (users.containsKey(username)) return null
                    val user = User(nextUserId++, username)
                    users[username] = StoredUser(user, passwordHash)
                    user
                }

            override suspend fun findUser(username: String) = users[username]

            override suspend fun createSession(
                tokenHash: ByteArray,
                userId: Long,
                expiresAt: Long,
            ) {
                sessions[java.util.HexFormat.of().formatHex(tokenHash)] = userId to expiresAt
            }

            override suspend fun findSession(
                tokenHash: ByteArray,
                now: Long,
            ): User? {
                val (userId, expiresAt) = sessions[java.util.HexFormat.of().formatHex(tokenHash)] ?: return null
                return if (expiresAt > now) userById(userId) else null
            }

            override suspend fun deleteSession(tokenHash: ByteArray) {
                sessions.remove(java.util.HexFormat.of().formatHex(tokenHash))
            }
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

            override suspend fun userIdOf(username: String) = users[username]?.user?.id
        }

    val collab =
        object : CollabRepository {
            override suspend fun load(documentId: String) =
                synchronized(updates) { updates[documentId].orEmpty().sortedBy { it.seq } }

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
}

/** PBKDF2 at full strength makes tests slow; the format is the same. */
fun fastAuthIntents(db: FakeDatabase) =
    AuthIntents(db.auth, hashPassword = { Secrets.hashPassword(it, iterations = 1_000) })

fun testDependencies(
    db: FakeDatabase = FakeDatabase(),
    compactAfter: Int = 200,
) = Dependencies(
    health =
        HealthIntents(
            object : HealthRepository {
                override suspend fun pingDatabase() {}
            },
            "test",
        ),
    auth = fastAuthIntents(db),
    documents = DocumentsIntents(db.docs),
    collab = CollabIntents(db.collab, compactAfter = compactAfter),
)

val testConfig = AppConfig.fromEnv(emptyMap())
