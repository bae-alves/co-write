package dev.cowrite.server

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import dev.cowrite.server.db.SchemaRepository
import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.JdbcAuthRepository
import dev.cowrite.server.features.collab.CollabIntents
import dev.cowrite.server.features.collab.JdbcCollabRepository
import dev.cowrite.server.features.documents.DocumentsIntents
import dev.cowrite.server.features.documents.JdbcDocumentsRepository
import dev.cowrite.server.features.health.HealthIntents
import dev.cowrite.server.features.health.JdbcHealthRepository
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import org.slf4j.LoggerFactory
import kotlin.concurrent.thread

private val log = LoggerFactory.getLogger("dev.cowrite.server")

/** Composition root: the one place where concrete repositories are built and handed to intents. */
fun main() {
    val config = AppConfig.fromEnv()

    val dataSource =
        HikariDataSource(
            HikariConfig().apply {
                jdbcUrl = config.databaseUrl
                username = config.databaseUser
                password = config.databasePassword
                maximumPoolSize = 8
                connectionTimeout = 2_000
                // Start even when PostgreSQL is down; /health reports it as degraded instead.
                initializationFailTimeout = -1
            },
        )

    // Migrate in the background until PostgreSQL answers, so the server can start first.
    thread(isDaemon = true, name = "migrations") {
        while (true) {
            try {
                val applied = SchemaRepository(dataSource).migrate()
                log.info("Database schema up to date (applied: {})", applied.ifEmpty { "nothing" })
                break
            } catch (e: Exception) {
                log.warn("Migrations failed, retrying in 5 s: {}", e.message)
                Thread.sleep(5_000)
            }
        }
    }

    val auth = AuthIntents(JdbcAuthRepository(dataSource))
    val dependencies =
        Dependencies(
            health = HealthIntents(JdbcHealthRepository(dataSource), config.version),
            auth = auth,
            documents = DocumentsIntents(JdbcDocumentsRepository(dataSource)),
            collab = CollabIntents(JdbcCollabRepository(dataSource), compactAfter = config.compactAfter),
        )

    embeddedServer(Netty, port = config.port) { module(config, dependencies) }.start(wait = true)
}
