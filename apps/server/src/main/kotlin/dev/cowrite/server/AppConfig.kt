package dev.cowrite.server

/**
 * How the instance decides who a request is from.
 *
 *  - [ACCOUNTS] (the default): key-based accounts, optional OAuth, per-document roles.
 *  - [NONE]: no accounts and no sign-in. Everyone who can reach the server is an editor of every
 *    document. For a home server, a LAN or a VPN; never expose it to the internet.
 */
enum class AuthMode(
    val wire: String,
) {
    NONE("none"),
    ACCOUNTS("accounts"),
    ;

    companion object {
        fun parse(value: String): AuthMode =
            entries.firstOrNull { it.wire == value.trim().lowercase() }
                ?: throw IllegalArgumentException("AUTH must be 'none' or 'accounts', not '$value'")
    }
}

/** An OAuth provider this instance offers. `issuer` is set for the generic OIDC provider only. */
data class OAuthConfig(
    val id: String,
    val label: String,
    val clientId: String,
    val clientSecret: String,
    val issuer: String? = null,
)

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
    val authMode: AuthMode = AuthMode.ACCOUNTS,
    /**
     * The URL clients reach this server at (`https://write.example.com`). Signatures are bound to it,
     * and OAuth callbacks are built from it. Unset: taken from each request (and `X-Forwarded-*`
     * headers when [trustProxy] is on).
     */
    val publicUrl: String? = null,
    /** Behind a reverse proxy: read the client IP and scheme from `X-Forwarded-*` headers. */
    val trustProxy: Boolean = false,
    /** Requests per minute and client IP on the sign-in, OAuth and ticket endpoints. */
    val rateLimitPerMinute: Int = 30,
    val oauth: List<OAuthConfig> = emptyList(),
) {
    companion object {
        fun fromEnv(env: Map<String, String> = System.getenv()): AppConfig {
            val authMode = AuthMode.parse(env["AUTH"] ?: "accounts")
            fun value(name: String) = env[name]?.trim()?.takeIf { it.isNotEmpty() }
            val github =
                listOfNotNull(value("OAUTH_GITHUB_CLIENT_ID"), value("OAUTH_GITHUB_CLIENT_SECRET"))
                    .takeIf { it.size == 2 }
                    ?.let { (id, secret) -> OAuthConfig("github", "GitHub", id, secret) }
            val oidc =
                listOfNotNull(value("OAUTH_OIDC_ISSUER"), value("OAUTH_OIDC_CLIENT_ID"), value("OAUTH_OIDC_CLIENT_SECRET"))
                    .takeIf { it.size == 3 }
                    ?.let { (issuer, id, secret) ->
                        OAuthConfig("oidc", value("OAUTH_OIDC_NAME") ?: "Single sign-on", id, secret, issuer.trimEnd('/'))
                    }
            return AppConfig(
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
                authMode = authMode,
                publicUrl = value("PUBLIC_URL"),
                trustProxy = env["TRUST_PROXY"]?.trim()?.lowercase() == "true",
                rateLimitPerMinute = env["RATE_LIMIT_PER_MINUTE"]?.toInt() ?: 30,
                // OAuth is the only outbound traffic there is, and AUTH=none makes none.
                oauth = if (authMode == AuthMode.NONE) emptyList() else listOfNotNull(github, oidc),
            )
        }
    }
}
