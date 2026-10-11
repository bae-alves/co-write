package dev.cowrite.server.features.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.sql.SQLException
import java.sql.Timestamp
import javax.sql.DataSource

interface AuthRepository {
    /** Creates the user; null when the username is taken. */
    suspend fun createUser(
        username: String,
        passwordHash: String,
    ): User?

    suspend fun findUser(username: String): StoredUser?

    suspend fun createSession(
        tokenHash: ByteArray,
        userId: Long,
        expiresAt: Long,
    )

    /** The user owning an unexpired session with this token hash. */
    suspend fun findSession(
        tokenHash: ByteArray,
        now: Long,
    ): User?

    suspend fun deleteSession(tokenHash: ByteArray)
}

private const val UNIQUE_VIOLATION = "23505"

/** The only code in this feature that talks to PostgreSQL. */
class JdbcAuthRepository(
    private val dataSource: DataSource,
) : AuthRepository {
    private suspend fun <T> db(block: (java.sql.Connection) -> T): T =
        withContext(Dispatchers.IO) { dataSource.connection.use(block) }

    override suspend fun createUser(
        username: String,
        passwordHash: String,
    ): User? =
        db { connection ->
            try {
                connection
                    .prepareStatement(
                        "INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id",
                    ).use { statement ->
                        statement.setString(1, username)
                        statement.setString(2, passwordHash)
                        statement.executeQuery().use { rows ->
                            rows.next()
                            User(rows.getLong(1), username)
                        }
                    }
            } catch (e: SQLException) {
                if (e.sqlState == UNIQUE_VIOLATION) null else throw e
            }
        }

    override suspend fun findUser(username: String): StoredUser? =
        db { connection ->
            connection.prepareStatement("SELECT id, username, password_hash FROM users WHERE username = ?").use { statement ->
                statement.setString(1, username)
                statement.executeQuery().use { rows ->
                    if (!rows.next()) {
                        null
                    } else {
                        StoredUser(User(rows.getLong(1), rows.getString(2)), rows.getString(3))
                    }
                }
            }
        }

    override suspend fun createSession(
        tokenHash: ByteArray,
        userId: Long,
        expiresAt: Long,
    ) {
        db { connection ->
            connection.prepareStatement("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").use { statement ->
                statement.setBytes(1, tokenHash)
                statement.setLong(2, userId)
                statement.setTimestamp(3, Timestamp(expiresAt))
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
}
