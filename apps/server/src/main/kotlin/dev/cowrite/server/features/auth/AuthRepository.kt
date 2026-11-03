package dev.cowrite.server.features.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.sql.Connection
import java.sql.SQLException
import java.sql.Timestamp
import javax.sql.DataSource

interface AuthRepository {
    /** Creates the user, and their first key in the same transaction when there is one. */
    suspend fun createUser(
        username: String,
        key: NewKey?,
    ): CreateUserOutcome

    suspend fun findUser(username: String): User?

    suspend fun keysOf(userId: Long): List<StoredKey>

    /** Null when that key is already registered (to any account). */
    suspend fun addKey(
        userId: Long,
        key: NewKey,
        now: Long,
    ): StoredKey?

    /** Deletes the key; its sessions go with it. */
    suspend fun removeKey(
        userId: Long,
        keyId: Long,
    ): Boolean

    /** Keys plus linked OAuth identities: the ways the account can still sign in. */
    suspend fun signInMethodCount(userId: Long): Int

    /** Stores the nonce's hash, and drops challenges that have expired. */
    suspend fun saveChallenge(
        nonceHash: ByteArray,
        expiresAt: Long,
        now: Long,
    )

    /** True exactly once per unexpired challenge. */
    suspend fun consumeChallenge(
        nonceHash: ByteArray,
        now: Long,
    ): Boolean

    suspend fun createSession(
        tokenHash: ByteArray,
        userId: Long,
        keyId: Long?,
        expiresAt: Long,
    )

    /** The user owning an unexpired session with this token hash. */
    suspend fun findSession(
        tokenHash: ByteArray,
        now: Long,
    ): User?

    suspend fun deleteSession(tokenHash: ByteArray)

    suspend fun deleteUser(userId: Long)
}

private const val UNIQUE_VIOLATION = "23505"

/** The only code in this feature that talks to PostgreSQL. */
class JdbcAuthRepository(
    private val dataSource: DataSource,
) : AuthRepository {
    private suspend fun <T> db(block: (Connection) -> T): T = withContext(Dispatchers.IO) { dataSource.connection.use(block) }

    private fun Connection.insertKey(
        userId: Long,
        key: NewKey,
        now: Long,
    ): Long =
        prepareStatement(
            "INSERT INTO account_keys (user_id, public_key, fingerprint, label, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
        ).use { statement ->
            statement.setLong(1, userId)
            statement.setBytes(2, key.publicKey)
            statement.setString(3, key.fingerprint)
            statement.setString(4, key.label)
            statement.setTimestamp(5, Timestamp(now))
            statement.executeQuery().use { rows ->
                rows.next()
                rows.getLong(1)
            }
        }

    override suspend fun createUser(
        username: String,
        key: NewKey?,
    ): CreateUserOutcome =
        db { connection ->
            connection.autoCommit = false
            try {
                val user =
                    try {
                        connection.prepareStatement("INSERT INTO users (username) VALUES (?) RETURNING id").use { statement ->
                            statement.setString(1, username)
                            statement.executeQuery().use { rows ->
                                rows.next()
                                User(rows.getLong(1), username)
                            }
                        }
                    } catch (e: SQLException) {
                        connection.rollback()
                        if (e.sqlState == UNIQUE_VIOLATION) return@db CreateUserOutcome.UsernameTaken
                        throw e
                    }
                val keyId =
                    try {
                        key?.let { connection.insertKey(user.id, it, System.currentTimeMillis()) }
                    } catch (e: SQLException) {
                        connection.rollback()
                        if (e.sqlState == UNIQUE_VIOLATION) return@db CreateUserOutcome.KeyTaken
                        throw e
                    }
                connection.commit()
                CreateUserOutcome.Created(user, keyId)
            } catch (e: Exception) {
                runCatching { connection.rollback() }
                throw e
            } finally {
                connection.autoCommit = true
            }
        }

    override suspend fun findUser(username: String): User? =
        db { connection ->
            connection.prepareStatement("SELECT id, username FROM users WHERE username = ?").use { statement ->
                statement.setString(1, username)
                statement.executeQuery().use { rows -> if (rows.next()) User(rows.getLong(1), rows.getString(2)) else null }
            }
        }

    override suspend fun keysOf(userId: Long): List<StoredKey> =
        db { connection ->
            connection
                .prepareStatement(
                    "SELECT id, public_key, fingerprint, label, created_at FROM account_keys WHERE user_id = ? ORDER BY id",
                ).use { statement ->
                    statement.setLong(1, userId)
                    statement.executeQuery().use { rows ->
                        buildList {
                            while (rows.next()) {
                                add(
                                    StoredKey(
                                        rows.getLong(1),
                                        rows.getBytes(2),
                                        rows.getString(3),
                                        rows.getString(4),
                                        rows.getTimestamp(5).time,
                                    ),
                                )
                            }
                        }
                    }
                }
        }

    override suspend fun addKey(
        userId: Long,
        key: NewKey,
        now: Long,
    ): StoredKey? =
        db { connection ->
            try {
                val id = connection.insertKey(userId, key, now)
                StoredKey(id, key.publicKey, key.fingerprint, key.label, now)
            } catch (e: SQLException) {
                if (e.sqlState == UNIQUE_VIOLATION) null else throw e
            }
        }

    override suspend fun removeKey(
        userId: Long,
        keyId: Long,
    ): Boolean =
        db { connection ->
            connection.prepareStatement("DELETE FROM account_keys WHERE id = ? AND user_id = ?").use { statement ->
                statement.setLong(1, keyId)
                statement.setLong(2, userId)
                statement.executeUpdate() > 0
            }
        }

    override suspend fun signInMethodCount(userId: Long): Int =
        db { connection ->
            connection
                .prepareStatement(
                    "SELECT (SELECT count(*) FROM account_keys WHERE user_id = ?) + (SELECT count(*) FROM oauth_identities WHERE user_id = ?)",
                ).use { statement ->
                    statement.setLong(1, userId)
                    statement.setLong(2, userId)
                    statement.executeQuery().use { rows ->
                        rows.next()
                        rows.getInt(1)
                    }
                }
        }

    override suspend fun saveChallenge(
        nonceHash: ByteArray,
        expiresAt: Long,
        now: Long,
    ) {
        db { connection ->
            connection.prepareStatement("DELETE FROM login_challenges WHERE expires_at <= ?").use { statement ->
                statement.setTimestamp(1, Timestamp(now))
                statement.executeUpdate()
            }
            connection.prepareStatement("INSERT INTO login_challenges (nonce_hash, expires_at) VALUES (?, ?)").use { statement ->
                statement.setBytes(1, nonceHash)
                statement.setTimestamp(2, Timestamp(expiresAt))
                statement.executeUpdate()
            }
        }
    }

    override suspend fun consumeChallenge(
        nonceHash: ByteArray,
        now: Long,
    ): Boolean =
        db { connection ->
            // One statement, so two requests with the same nonce cannot both succeed.
            connection.prepareStatement("DELETE FROM login_challenges WHERE nonce_hash = ? AND expires_at > ?").use { statement ->
                statement.setBytes(1, nonceHash)
                statement.setTimestamp(2, Timestamp(now))
                statement.executeUpdate() > 0
            }
        }

    override suspend fun createSession(
        tokenHash: ByteArray,
        userId: Long,
        keyId: Long?,
        expiresAt: Long,
    ) {
        db { connection ->
            connection
                .prepareStatement("INSERT INTO sessions (token_hash, user_id, key_id, expires_at) VALUES (?, ?, ?, ?)")
                .use { statement ->
                    statement.setBytes(1, tokenHash)
                    statement.setLong(2, userId)
                    if (keyId == null) statement.setNull(3, java.sql.Types.BIGINT) else statement.setLong(3, keyId)
                    statement.setTimestamp(4, Timestamp(expiresAt))
                    statement.executeUpdate()
                }
        }
    }

    override suspend fun findSession(
        tokenHash: ByteArray,
        now: Long,
    ): User? =
        db { connection ->
            connection
                .prepareStatement(
                    """
                    SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
                    WHERE s.token_hash = ? AND s.expires_at > ?
                    """.trimIndent(),
                ).use { statement ->
                    statement.setBytes(1, tokenHash)
                    statement.setTimestamp(2, Timestamp(now))
                    statement.executeQuery().use { rows ->
                        if (rows.next()) User(rows.getLong(1), rows.getString(2)) else null
                    }
                }
        }

    override suspend fun deleteSession(tokenHash: ByteArray) {
        db { connection ->
            connection.prepareStatement("DELETE FROM sessions WHERE token_hash = ?").use { statement ->
                statement.setBytes(1, tokenHash)
                statement.executeUpdate()
            }
        }
    }

    override suspend fun deleteUser(userId: Long) {
        db { connection ->
            // Keys, identities, sessions, memberships and owned documents cascade.
            connection.prepareStatement("DELETE FROM users WHERE id = ?").use { statement ->
                statement.setLong(1, userId)
                statement.executeUpdate()
            }
        }
    }
}
