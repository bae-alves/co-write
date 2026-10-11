package dev.cowrite.server.features.documents

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.sql.Connection
import java.sql.ResultSet
import java.sql.Timestamp
import javax.sql.DataSource

interface DocumentsRepository {
    /** Creates the document and makes `ownerId` its owner. */
    suspend fun create(
        id: String,
        title: String,
        ownerId: Long,
        now: Long,
    ): Document

    suspend fun listFor(userId: Long): List<Document>

    suspend fun exists(documentId: String): Boolean

    /** The user's role on the document, or null if they are not a member. */
    suspend fun roleOf(
        documentId: String,
        userId: Long,
    ): Role?

    /** Adds the user or changes their role. */
    suspend fun setMember(
        documentId: String,
        userId: Long,
        role: Role,
    )

    suspend fun userIdOf(username: String): Long?
}

/** The only code in this feature that talks to PostgreSQL. */
class JdbcDocumentsRepository(
    private val dataSource: DataSource,
) : DocumentsRepository {
    private suspend fun <T> db(block: (Connection) -> T): T = withContext(Dispatchers.IO) { dataSource.connection.use(block) }

    private fun ResultSet.toDocument() =
        Document(
            id = getString("id"),
            title = getString("title"),
            owner = getString("owner"),
            role = Role.fromWire(getString("role")) ?: Role.VIEWER,
            updatedAt = getTimestamp("updated_at").time,
        )

    override suspend fun create(
        id: String,
        title: String,
        ownerId: Long,
        now: Long,
    ): Document =
        db { connection ->
            connection.autoCommit = false
            try {
                connection
                    .prepareStatement("INSERT INTO documents (id, title, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
                    .use { statement ->
                        statement.setString(1, id)
                        statement.setString(2, title)
                        statement.setLong(3, ownerId)
                        statement.setTimestamp(4, Timestamp(now))
                        statement.setTimestamp(5, Timestamp(now))
                        statement.executeUpdate()
                    }
                connection.prepareStatement("INSERT INTO document_members (document_id, user_id, role) VALUES (?, ?, 'owner')").use { statement ->
                    statement.setString(1, id)
                    statement.setLong(2, ownerId)
                    statement.executeUpdate()
                }
                val owner =
                    connection.prepareStatement("SELECT username FROM users WHERE id = ?").use { statement ->
                        statement.setLong(1, ownerId)
                        statement.executeQuery().use { rows ->
                            rows.next()
                            rows.getString(1)
                        }
                    }
                connection.commit()
                Document(id, title, owner, Role.OWNER, now)
            } catch (e: Exception) {
                connection.rollback()
                throw e
            } finally {
                connection.autoCommit = true
            }
        }

    override suspend fun listFor(userId: Long): List<Document> =
        db { connection ->
            connection
                .prepareStatement(
                    """
                    SELECT d.id, d.title, o.username AS owner, m.role, d.updated_at
                    FROM document_members m
                    JOIN documents d ON d.id = m.document_id
                    JOIN users o ON o.id = d.owner_id
                    WHERE m.user_id = ?
                    ORDER BY d.updated_at DESC
                    """.trimIndent(),
                ).use { statement ->
                    statement.setLong(1, userId)
                    statement.executeQuery().use { rows ->
                        buildList { while (rows.next()) add(rows.toDocument()) }
                    }
                }
        }

    override suspend fun exists(documentId: String): Boolean =
        db { connection ->
            connection.prepareStatement("SELECT 1 FROM documents WHERE id = ?").use { statement ->
                statement.setString(1, documentId)
                statement.executeQuery().use { it.next() }
            }
        }

    override suspend fun roleOf(
        documentId: String,
        userId: Long,
    ): Role? =
        db { connection ->
            connection.prepareStatement("SELECT role FROM document_members WHERE document_id = ? AND user_id = ?").use { statement ->
                statement.setString(1, documentId)
                statement.setLong(2, userId)
                statement.executeQuery().use { rows -> if (rows.next()) Role.fromWire(rows.getString(1)) else null }
            }
        }

    override suspend fun setMember(
        documentId: String,
        userId: Long,
        role: Role,
    ) {
        db { connection ->
            connection
                .prepareStatement(
                    """
                    INSERT INTO document_members (document_id, user_id, role) VALUES (?, ?, ?)
                    ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role
                    """.trimIndent(),
                ).use { statement ->
                    statement.setString(1, documentId)
                    statement.setLong(2, userId)
                    statement.setString(3, role.wire)
                    statement.executeUpdate()
                }
        }
    }

    override suspend fun userIdOf(username: String): Long? =
        db { connection ->
            connection.prepareStatement("SELECT id FROM users WHERE username = ?").use { statement ->
                statement.setString(1, username)
                statement.executeQuery().use { rows -> if (rows.next()) rows.getLong(1) else null }
            }
        }
}
