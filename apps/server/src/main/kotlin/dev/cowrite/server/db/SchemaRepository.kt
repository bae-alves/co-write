package dev.cowrite.server.db

import java.sql.Connection
import javax.sql.DataSource

/**
 * Applies the SQL migrations in `resources/db/` in order, once each, recording them in
 * `schema_migrations`. Concurrent servers serialize on an advisory lock.
 */
class SchemaRepository(
    private val dataSource: DataSource,
) {
    companion object {
        val MIGRATIONS = listOf("V1__init.sql")
        private const val LOCK_KEY = 7_311_942L
    }

    fun migrate(): List<String> =
        dataSource.connection.use { connection ->
            connection.createStatement().use { it.execute("SELECT pg_advisory_lock($LOCK_KEY)") }
            try {
                connection.createStatement().use {
                    it.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
                }
                val applied =
                    connection.createStatement().use { statement ->
                        statement.executeQuery("SELECT name FROM schema_migrations").use { rows ->
                            buildSet { while (rows.next()) add(rows.getString(1)) }
                        }
                    }
                MIGRATIONS.filterNot { it in applied }.onEach { apply(connection, it) }
            } finally {
                connection.createStatement().use { it.execute("SELECT pg_advisory_unlock($LOCK_KEY)") }
            }
        }

    private fun apply(
        connection: Connection,
        name: String,
    ) {
        val sql =
            checkNotNull(javaClass.getResource("/db/$name")) { "Missing migration $name" }.readText()
        connection.autoCommit = false
        try {
            connection.createStatement().use { it.execute(sql) }
            connection.prepareStatement("INSERT INTO schema_migrations (name) VALUES (?)").use {
                it.setString(1, name)
                it.executeUpdate()
            }
            connection.commit()
        } catch (e: Exception) {
            connection.rollback()
            throw e
        } finally {
            connection.autoCommit = true
        }
    }
}
