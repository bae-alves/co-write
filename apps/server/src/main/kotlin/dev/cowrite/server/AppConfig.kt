package dev.cowrite.server

/** Process configuration, read once at startup from the environment. */
data class AppConfig(
    val port: Int,
    val version: String,
    val databaseUrl: String,
    val databaseUser: String,
    val databasePassword: String,
    val corsAllowedHosts: List<String>,
    /** Stored updates per document before the server asks a client for a compacted snapshot. */
    val compactAfter: Int,
) {
    companion object {
        fun fromEnv(env: Map<String, String> = System.getenv()): AppConfig =
            AppConfig(
                port = env["PORT"]?.toInt() ?: 8080,
                version = env["APP_VERSION"] ?: "0.0.0-dev",
                databaseUrl = env["DATABASE_URL"] ?: "jdbc:postgresql://localhost:5432/cowrite",
                databaseUser = env["DATABASE_USER"] ?: "cowrite",
                databasePassword = env["DATABASE_PASSWORD"] ?: "cowrite",
                corsAllowedHosts =
                    (env["CORS_ALLOWED_HOSTS"] ?: "localhost:5173")
                        .split(',')
                        .map { it.trim() }
                        .filter { it.isNotEmpty() },
                compactAfter = env["COMPACT_AFTER"]?.toInt() ?: 200,
            )
    }
}
