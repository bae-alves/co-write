package dev.cowrite.server.features.tickets

import dev.cowrite.server.features.auth.User
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.sql.Connection
import java.sql.Timestamp
import javax.sql.DataSource

interface TicketsRepository {
    /** Stores the ticket's hash, and drops tickets that have expired. */
    suspend fun save(
        ticketHash: ByteArray,
        userId: Long,
        documentId: String,
        expiresAt: Long,
        now: Long,
    )

    /** Deletes and returns the ticket's user when it is unexpired and was issued for `documentId`. */
    suspend fun redeem(
        ticketHash: ByteArray,
        documentId: String,
        now: Long,
    ): User?
}

/** The only code in this feature that talks to PostgreSQL. */
class JdbcTicketsRepository(
    private val dataSource: DataSource,
) : TicketsRepository {
    private suspend fun <T> db(block: (Connection) -> T): T = withContext(Dispatchers.IO) { dataSource.connection.use(block) }

    override suspend fun save(
        ticketHash: ByteArray,
        userId: Long,
        documentId: String,
        expiresAt: Long,
        now: Long,
    ) {
        db { connection ->
            connection.prepareStatement("DELETE FROM ws_tickets WHERE expires_at <= ?").use { statement ->
                statement.setTimestamp(1, Timestamp(now))
                statement.executeUpdate()
            }
            connection
                .prepareStatement("INSERT INTO ws_tickets (ticket_hash, user_id, document_id, expires_at) VALUES (?, ?, ?, ?)")
                .use { statement ->
                    statement.setBytes(1, ticketHash)
                    statement.setLong(2, userId)
                    statement.setString(3, documentId)
                    statement.setTimestamp(4, Timestamp(expiresAt))
                    statement.executeUpdate()
                }
        }
    }

    override suspend fun redeem(
        ticketHash: ByteArray,
        documentId: String,
        now: Long,
    ): User? =
        db { connection ->
            // One statement: the ticket is gone the moment anyone presents it, valid or not for this document.
            connection
                .prepareStatement(
                    """
                    WITH used AS (
                        DELETE FROM ws_tickets WHERE ticket_hash = ? AND expires_at > ?
                        RETURNING user_id, document_id
                    )
                    SELECT u.id, u.username FROM used JOIN users u ON u.id = used.user_id WHERE used.document_id = ?
                    """.trimIndent(),
                ).use { statement ->
                    statement.setBytes(1, ticketHash)
                    statement.setTimestamp(2, Timestamp(now))
                    statement.setString(3, documentId)
                    statement.executeQuery().use { rows -> if (rows.next()) User(rows.getLong(1), rows.getString(2)) else null }
                }
        }
}
