package dev.cowrite.server

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import dev.cowrite.server.db.SchemaRepository
import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.JdbcAuthRepository
import dev.cowrite.server.features.collab.CollabCloseCode
import dev.cowrite.server.features.collab.CollabIntents
import dev.cowrite.server.features.collab.JdbcCollabRepository
import dev.cowrite.server.features.documents.DocumentsIntents
import dev.cowrite.server.features.documents.JdbcDocumentsRepository
import dev.cowrite.server.features.health.HealthIntents
import dev.cowrite.server.features.health.JdbcHealthRepository
import dev.cowrite.server.features.instance.InstanceInfo
import dev.cowrite.server.features.instance.InstanceIntents
import dev.cowrite.server.features.instance.OAuthProviderInfo
import dev.cowrite.server.features.oauth.HttpOAuthProviderRepository
import dev.cowrite.server.features.oauth.JdbcOAuthRepository
import dev.cowrite.server.features.oauth.OAuthIntents
import dev.cowrite.server.features.tickets.JdbcTicketsRepository
import dev.cowrite.server.features.tickets.TicketsIntents
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import org.slf4j.LoggerFactory
import kotlin.concurrent.thread

private val log = LoggerFactory.getLogger("dev.cowrite.server")

/** Composition root: the one place where concrete repositories are built and handed to intents. */
fun main() {
    val config = AppConfig.fromEnv()
    if (config.authMode == AuthMode.NONE) {
        log.warn(
            "AUTH=none: there are no accounts and every document is open to everyone who can reach this " +
                "server. Do not expose it to the internet.",
        )
    }

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

    val collab = CollabIntents(JdbcCollabRepository(dataSource), compactAfter = config.compactAfter)
    val open = config.authMode == AuthMode.NONE
    val documents =
        DocumentsIntents(
            JdbcDocumentsRepository(dataSource),
            open = open,
            // A changed role or a removal takes effect now: close the member's sockets. A role change
            // lets the client reconnect (and be authorised again); a removal does not.
            onMemberChanged = { documentId, userId, removed ->
                collab.disconnect(
                    userId,
                    if (removed) CollabCloseCode.FORBIDDEN else CollabCloseCode.ROLE_CHANGED,
                    if (removed) "Removed from the document." else "Your role changed.",
                    documentId,
                )
            },
        )
    val auth =
        AuthIntents(
            JdbcAuthRepository(dataSource),
            mode = config.authMode,
            onAccountDeleted = { user -> collab.disconnect(user.id, CollabCloseCode.UNAUTHENTICATED, "Account deleted.") },
        )
    val oauth =
        config.oauth.takeIf { it.isNotEmpty() }?.let {
            OAuthIntents(JdbcOAuthRepository(dataSource), HttpOAuthProviderRepository(it), auth)
        }
    val dependencies =
        Dependencies(
            health = HealthIntents(JdbcHealthRepository(dataSource), config.version),
            instance =
                InstanceIntents(
                    InstanceInfo(config.authMode, config.oauth.map { OAuthProviderInfo(it.id, it.label) }, config.version),
                ),
            auth = auth,
            documents = documents,
            collab = collab,
            tickets = TicketsIntents(JdbcTicketsRepository(dataSource), documents),
            oauth = oauth,
        )

    embeddedServer(Netty, port = config.port) { module(config, dependencies) }.start(wait = true)
}
