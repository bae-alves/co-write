package dev.cowrite.server

import dev.cowrite.server.features.health.HealthIntents
import dev.cowrite.server.features.health.JdbcHealthRepository
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource

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

    val dependencies =
        Dependencies(
            health = HealthIntents(JdbcHealthRepository(dataSource), config.version),
        )

    embeddedServer(Netty, port = config.port) { module(config, dependencies) }.start(wait = true)
}
