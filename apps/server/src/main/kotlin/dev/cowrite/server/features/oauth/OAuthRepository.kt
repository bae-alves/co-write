package dev.cowrite.server.features.oauth

import dev.cowrite.server.features.auth.User
import dev.cowrite.server.features.instance.OAuthProviderInfo
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.URLBuilder
import io.ktor.http.isSuccess
import io.ktor.http.parameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.sql.Connection
import java.sql.SQLException
import java.sql.Timestamp
import javax.sql.DataSource

// ---- The provider's side: authorize URL, code → access token → identity ---------------------

/** What the instance needs from an OAuth provider. The only place that talks HTTP to one. */
interface OAuthProviderClient {
    fun providers(): List<OAuthProviderInfo>

    /** Where to send the browser; null for a provider this instance does not offer. */
    suspend fun authorizeUrl(
        providerId: String,
        state: String,
        redirectUri: String,
    ): String?

    /** Trades the authorization code for who the user is. Throws [OAuthFailure]. */
    suspend fun fetchIdentity(
        providerId: String,
        code: String,
        redirectUri: String,
    ): OAuthIdentity
}

/** GitHub, plus any OpenID Connect issuer (discovery document + userinfo endpoint). */
class HttpOAuthProviderRepository(
    private val configs: List<dev.cowrite.server.OAuthConfig>,
    private val client: HttpClient =
        HttpClient(CIO) {
            install(HttpTimeout) {
                requestTimeoutMillis = 10_000
                connectTimeoutMillis = 5_000
            }
        },
) : OAuthProviderClient {
    private class Endpoints(
        val authorize: String,
        val token: String,
        val userInfo: String,
        val scope: String,
    )

    private val json = Json { ignoreUnknownKeys = true }
    private var discovered: Endpoints? = null

    override fun providers() = configs.map { OAuthProviderInfo(it.id, it.label) }

    private suspend fun endpoints(config: dev.cowrite.server.OAuthConfig): Endpoints {
        if (config.id == "github") {
            return Endpoints(
                "https://github.com/login/oauth/authorize",
                "https://github.com/login/oauth/access_token",
                "https://api.github.com/user",
                "read:user",
            )
        }
        discovered?.let { return it }
        val response = client.get("${config.issuer}/.well-known/openid-configuration")
        if (!response.status.isSuccess()) throw OAuthFailure("The OpenID Connect discovery document is unavailable.")
        val document = json.parseToJsonElement(response.bodyAsText()).jsonObject
        fun field(name: String) = document[name]?.jsonPrimitive?.contentOrNull ?: throw OAuthFailure("Discovery document lacks $name.")
        return Endpoints(field("authorization_endpoint"), field("token_endpoint"), field("userinfo_endpoint"), "openid profile").also {
            discovered = it
        }
    }

    override suspend fun authorizeUrl(
        providerId: String,
        state: String,
        redirectUri: String,
    ): String? {
        val config = configs.firstOrNull { it.id == providerId } ?: return null
        val endpoints = try {
            endpoints(config)
        } catch (e: Exception) {
            return null
        }
        return URLBuilder(endpoints.authorize)
            .apply {
                parameters.append("client_id", config.clientId)
                parameters.append("redirect_uri", redirectUri)
                parameters.append("response_type", "code")
                parameters.append("scope", endpoints.scope)
                parameters.append("state", state)
            }.buildString()
    }

    override suspend fun fetchIdentity(
        providerId: String,
        code: String,
        redirectUri: String,
    ): OAuthIdentity {
        val config = configs.firstOrNull { it.id == providerId } ?: throw OAuthFailure("Unknown provider.")
        try {
            val endpoints = endpoints(config)
            val tokenResponse =
                client.submitForm(
                    endpoints.token,
                    parameters {
                        append("grant_type", "authorization_code")
                        append("code", code)
                        append("redirect_uri", redirectUri)
                        append("client_id", config.clientId)
                        append("client_secret", config.clientSecret)
                    },
                ) { header(HttpHeaders.Accept, "application/json") }
            if (!tokenResponse.status.isSuccess()) throw OAuthFailure("The provider refused the code.")
            val accessToken =
                json.parseToJsonElement(tokenResponse.bodyAsText()).jsonObject["access_token"]?.jsonPrimitive?.contentOrNull
                    ?: throw OAuthFailure("The provider sent no access token.")
            val userResponse =
                client.get(endpoints.userInfo) {
                    header(HttpHeaders.Authorization, "Bearer $accessToken")
                    header(HttpHeaders.Accept, "application/json")
                    header(HttpHeaders.UserAgent, "co-write")
                }
            if (userResponse.status != HttpStatusCode.OK) throw OAuthFailure("The provider would not say who you are.")
            return identityOf(config, json.parseToJsonElement(userResponse.bodyAsText()).jsonObject)
        } catch (e: OAuthFailure) {
            throw e
        } catch (e: Exception) {
            throw OAuthFailure("Could not reach the provider.")
        }
    }

    private fun identityOf(
        config: dev.cowrite.server.OAuthConfig,
        user: JsonObject,
    ): OAuthIdentity {
        fun text(name: String) = user[name]?.jsonPrimitive?.contentOrNull
        return if (config.id == "github") {
            OAuthIdentity("github", text("id") ?: throw OAuthFailure("GitHub sent no user id."), text("login") ?: "github-user")
        } else {
            val subject = text("sub") ?: throw OAuthFailure("The provider sent no subject.")
            OAuthIdentity(config.id, subject, text("preferred_username") ?: text("email")?.substringBefore('@') ?: subject)
        }
    }
}

// ---- Our side: flows, one-time codes, identities --------------------------------------------

interface OAuthRepository {
    suspend fun saveLinkIntent(
        intentHash: ByteArray,
        userId: Long,
        expiresAt: Long,
        now: Long,
    )

    /** The user who minted the intent; the intent is spent. */
    suspend fun consumeLinkIntent(
        intentHash: ByteArray,
        now: Long,
    ): Long?

    suspend fun saveFlow(
        stateHash: ByteArray,
        flow: Flow,
        expiresAt: Long,
        now: Long,
    )

    suspend fun consumeFlow(
        stateHash: ByteArray,
        now: Long,
    ): Flow?

    suspend fun saveCode(
        codeHash: ByteArray,
        userId: Long,
        codeChallenge: String,
        expiresAt: Long,
        now: Long,
    )

    suspend fun consumeCode(
        codeHash: ByteArray,
        now: Long,
    ): StoredCode?

    suspend fun userById(userId: Long): User?

    /** The account this provider identity is linked to. */
    suspend fun findIdentity(
        provider: String,
        subject: String,
    ): User?

    /** False when the identity is already linked to an account. */
    suspend fun linkIdentity(
        userId: Long,
        identity: OAuthIdentity,
    ): Boolean

    suspend fun identitiesOf(userId: Long): List<OAuthIdentity>

    suspend fun unlink(
        userId: Long,
        provider: String,
    ): Boolean
}

private const val UNIQUE_VIOLATION = "23505"

/** The only code in this feature (besides the provider client above) that talks to the outside. */
class JdbcOAuthRepository(
    private val dataSource: DataSource,
) : OAuthRepository {
    private suspend fun <T> db(block: (Connection) -> T): T = withContext(Dispatchers.IO) { dataSource.connection.use(block) }

    private fun Connection.purge(
        table: String,
        now: Long,
    ) = prepareStatement("DELETE FROM $table WHERE expires_at <= ?").use {
        it.setTimestamp(1, Timestamp(now))
        it.executeUpdate()
    }

    override suspend fun saveLinkIntent(
        intentHash: ByteArray,
        userId: Long,
        expiresAt: Long,
        now: Long,
    ) {
        db { connection ->
            connection.purge("oauth_link_intents", now)
            connection.prepareStatement("INSERT INTO oauth_link_intents (intent_hash, user_id, expires_at) VALUES (?, ?, ?)").use {
                it.setBytes(1, intentHash)
                it.setLong(2, userId)
                it.setTimestamp(3, Timestamp(expiresAt))
                it.executeUpdate()
            }
        }
    }

    override suspend fun consumeLinkIntent(
        intentHash: ByteArray,
        now: Long,
    ): Long? =
        db { connection ->
            connection
                .prepareStatement("DELETE FROM oauth_link_intents WHERE intent_hash = ? AND expires_at > ? RETURNING user_id")
                .use {
                    it.setBytes(1, intentHash)
                    it.setTimestamp(2, Timestamp(now))
                    it.executeQuery().use { rows -> if (rows.next()) rows.getLong(1) else null }
                }
        }

    override suspend fun saveFlow(
        stateHash: ByteArray,
        flow: Flow,
        expiresAt: Long,
        now: Long,
    ) {
        db { connection ->
            connection.purge("oauth_flows", now)
            connection
                .prepareStatement(
                    "INSERT INTO oauth_flows (state_hash, provider, port, code_challenge, link_user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
                ).use {
                    it.setBytes(1, stateHash)
                    it.setString(2, flow.provider)
                    it.setInt(3, flow.port)
                    it.setString(4, flow.codeChallenge)
                    if (flow.linkUserId == null) it.setNull(5, java.sql.Types.BIGINT) else it.setLong(5, flow.linkUserId)
                    it.setTimestamp(6, Timestamp(expiresAt))
                    it.executeUpdate()
                }
        }
    }

    override suspend fun consumeFlow(
        stateHash: ByteArray,
        now: Long,
    ): Flow? =
        db { connection ->
            connection
                .prepareStatement(
                    "DELETE FROM oauth_flows WHERE state_hash = ? AND expires_at > ? RETURNING provider, port, code_challenge, link_user_id",
                ).use {
                    it.setBytes(1, stateHash)
                    it.setTimestamp(2, Timestamp(now))
                    it.executeQuery().use { rows ->
                        if (!rows.next()) {
                            null
                        } else {
                            Flow(rows.getString(1), rows.getInt(2), rows.getString(3), rows.getLong(4).takeUnless { rows.wasNull() })
                        }
                    }
                }
        }

    override suspend fun saveCode(
        codeHash: ByteArray,
        userId: Long,
        codeChallenge: String,
        expiresAt: Long,
        now: Long,
    ) {
        db { connection ->
            connection.purge("oauth_codes", now)
            connection
                .prepareStatement("INSERT INTO oauth_codes (code_hash, user_id, code_challenge, expires_at) VALUES (?, ?, ?, ?)")
                .use {
                    it.setBytes(1, codeHash)
                    it.setLong(2, userId)
                    it.setString(3, codeChallenge)
                    it.setTimestamp(4, Timestamp(expiresAt))
                    it.executeUpdate()
                }
        }
    }

    override suspend fun consumeCode(
        codeHash: ByteArray,
        now: Long,
    ): StoredCode? =
        db { connection ->
            connection
                .prepareStatement(
                    """
                    WITH used AS (
                        DELETE FROM oauth_codes WHERE code_hash = ? AND expires_at > ? RETURNING user_id, code_challenge
                    )
                    SELECT u.id, u.username, used.code_challenge FROM used JOIN users u ON u.id = used.user_id
                    """.trimIndent(),
                ).use {
                    it.setBytes(1, codeHash)
                    it.setTimestamp(2, Timestamp(now))
                    it.executeQuery().use { rows ->
                        if (rows.next()) StoredCode(User(rows.getLong(1), rows.getString(2)), rows.getString(3)) else null
                    }
                }
        }

    override suspend fun userById(userId: Long): User? =
        db { connection ->
            connection.prepareStatement("SELECT id, username FROM users WHERE id = ?").use {
                it.setLong(1, userId)
                it.executeQuery().use { rows -> if (rows.next()) User(rows.getLong(1), rows.getString(2)) else null }
            }
        }

    override suspend fun findIdentity(
        provider: String,
        subject: String,
    ): User? =
        db { connection ->
            connection
                .prepareStatement(
                    "SELECT u.id, u.username FROM oauth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?",
                ).use {
                    it.setString(1, provider)
                    it.setString(2, subject)
                    it.executeQuery().use { rows -> if (rows.next()) User(rows.getLong(1), rows.getString(2)) else null }
                }
        }

    override suspend fun linkIdentity(
        userId: Long,
        identity: OAuthIdentity,
    ): Boolean =
        db { connection ->
            try {
                connection
                    .prepareStatement("INSERT INTO oauth_identities (provider, subject, user_id, login) VALUES (?, ?, ?, ?)")
                    .use {
                        it.setString(1, identity.provider)
                        it.setString(2, identity.subject)
                        it.setLong(3, userId)
                        it.setString(4, identity.login)
                        it.executeUpdate()
                    }
                true
            } catch (e: SQLException) {
                if (e.sqlState == UNIQUE_VIOLATION) false else throw e
            }
        }

    override suspend fun identitiesOf(userId: Long): List<OAuthIdentity> =
        db { connection ->
            connection
                .prepareStatement("SELECT provider, subject, login FROM oauth_identities WHERE user_id = ? ORDER BY provider")
                .use {
                    it.setLong(1, userId)
                    it.executeQuery().use { rows ->
                        buildList { while (rows.next()) add(OAuthIdentity(rows.getString(1), rows.getString(2), rows.getString(3))) }
                    }
                }
        }

    override suspend fun unlink(
        userId: Long,
        provider: String,
    ): Boolean =
        db { connection ->
            connection.prepareStatement("DELETE FROM oauth_identities WHERE user_id = ? AND provider = ?").use {
                it.setLong(1, userId)
                it.setString(2, provider)
                it.executeUpdate() > 0
            }
        }
}
