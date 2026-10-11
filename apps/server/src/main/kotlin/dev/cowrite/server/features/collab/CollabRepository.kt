package dev.cowrite.server.features.collab

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.sql.Connection
import java.sql.Timestamp
import javax.sql.DataSource

/** The per-document Yjs update log. Updates are opaque bytes. */
interface CollabRepository {
    suspend fun load(documentId: String): List<StoredUpdate>

    suspend fun append(
        documentId: String,
        seq: Long,
        data: ByteArray,
        now: Long,
    )

    /** Atomically replaces every update with seq ≤ `upTo` by `snapshot` (stored at seq `upTo`). */
    suspend fun compact(
        documentId: String,
        upTo: Long,
        snapshot: ByteArray,
    )
}

/** The only code in this feature that talks to PostgreSQL. */
class JdbcCollabRepository(
    private val dataSource: DataSource,
) : CollabRepository {
    private suspend fun <T> db(block: (Connection) -> T): T = withContext(Dispatchers.IO) { dataSource.connection.use(block) }

    private fun <T> Connection.transaction(block: () -> T): T {
        autoCommit = false
        try {
            return block().also { commit() }
        } catch (e: Exception) {
            rollback()
            throw e
        } finally {
            autoCommit = true
        }
    }

    override suspend fun load(documentId: String): List<StoredUpdate> =
        db { connection ->
            connection.prepareStatement("SELECT seq, data FROM document_updates WHERE document_id = ? ORDER BY seq").use { statement ->
                statement.setString(1, documentId)
                statement.executeQuery().use { rows ->
                    buildList { while (rows.next()) add(StoredUpdate(rows.getLong(1), rows.getBytes(2))) }
                }
            }
        }

    override suspend fun append(
        documentId: String,
        seq: Long,
        data: ByteArray,
        now: Long,
    ) {
        db { connection ->
            connection.transaction {
                connection.prepareStatement("INSERT INTO document_updates (document_id, seq, data) VALUES (?, ?, ?)").use { statement ->
                    statement.setString(1, documentId)
                    statement.setLong(2, seq)
                    statement.setBytes(3, data)
                    statement.executeUpdate()
                }
                connection.prepareStatement("UPDATE documents SET updated_at = ? WHERE id = ?").use { statement ->
                    statement.setTimestamp(1, Timestamp(now))
                    statement.setString(2, documentId)
                    statement.executeUpdate()
                }
            }
        }
    }

    override suspend fun compact(
        documentId: String,
        upTo: Long,
        snapshot: ByteArray,
    ) {
        db { connection ->
            connection.transaction {
                connection.prepareStatement("DELETE FROM document_updates WHERE document_id = ? AND seq <= ?").use { statement ->
                    statement.setString(1, documentId)
                    statement.setLong(2, upTo)
                    statement.executeUpdate()
                }
                connection.prepareStatement("INSERT INTO document_updates (document_id, seq, data) VALUES (?, ?, ?)").use { statement ->
                    statement.setString(1, documentId)
                    statement.setLong(2, upTo)
                    statement.setBytes(3, snapshot)
                    statement.executeUpdate()
                }
            }
        }
    }
}
