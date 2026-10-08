package dev.cowrite.server.features.health

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.sql.DataSource

interface HealthRepository {
    /** Returns normally when PostgreSQL answers; throws otherwise. */
    suspend fun pingDatabase()
}

/** The only code in this feature that talks to PostgreSQL. */
class JdbcHealthRepository(
    private val dataSource: DataSource,
) : HealthRepository {
    override suspend fun pingDatabase() {
        withContext(Dispatchers.IO) {
            dataSource.connection.use { connection ->
                connection.createStatement().use { it.execute("SELECT 1") }
            }
        }
    }
}
