package dev.cowrite.server.features.oauth

import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.auth.AuthResult
import dev.cowrite.server.features.auth.User
import dev.cowrite.server.features.instance.OAuthProviderInfo
import dev.cowrite.server.kit.Pkce
import dev.cowrite.server.kit.Secrets
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * OAuth sign-in for the desktop app. The browser never sees a session token:
 *
 *  1. The desktop opens `/api/oauth/{provider}/start?port=…&code_challenge=…` (PKCE, S256) in the
 *     system browser. The server does the provider round-trip with its own callback, so the client
 *     secret never leaves it.
 *  2. It then redirects to `http://127.0.0.1:{port}/?code=…` with a one-time code.
 *  3. The desktop exchanges that code and its PKCE verifier for a session token.
 *
 * A signed-in user can link a provider to their account instead (with a one-time link intent); an
 * identity signing in for the first time creates an account.
 */
class OAuthIntents(
    private val repository: OAuthRepository,
    private val provider: OAuthProviderClient,
    private val auth: AuthIntents,
    private val now: () -> Long = System::currentTimeMillis,
    private val flowLifetime: Duration = 10.minutes,
    private val codeLifetime: Duration = 60.seconds,
    private val intentLifetime: Duration = 5.minutes,
) {
    companion object {
        const val MIN_PORT = 1024
        const val MAX_PORT = 65535
        private const val MAX_ATTEMPTS = 8
    }

    fun providers(): List<OAuthProviderInfo> = provider.providers()

    /** One-time proof that a signed-in user wants to link a provider; carried by the browser instead of a token. */
    suspend fun linkIntent(user: User): String {
        val intent = Secrets.randomId(32)
        repository.saveLinkIntent(Secrets.hashToken(intent), user.id, now() + intentLifetime.inWholeMilliseconds, now())
        return intent
    }

    suspend fun start(
        providerId: String,
        port: Int?,
        codeChallenge: String?,
        linkIntent: String?,
        callbackUri: String,
    ): StartResult {
        if (provider.providers().none { it.id == providerId }) return StartResult.UnknownProvider
        if (port == null || port !in MIN_PORT..MAX_PORT) return StartResult.Invalid("The loopback port is missing or out of range.")
        if (codeChallenge == null || !Pkce.isChallenge(codeChallenge)) return StartResult.Invalid("The PKCE challenge is missing or malformed.")
        val linkUserId =
            linkIntent?.let {
                repository.consumeLinkIntent(Secrets.hashToken(it), now())
                    ?: return StartResult.Invalid("That link request expired. Start again from co-write.")
            }
        val state = Secrets.randomId(32)
        repository.saveFlow(
            Secrets.hashToken(state),
            Flow(providerId, port, codeChallenge, linkUserId),
            now() + flowLifetime.inWholeMilliseconds,
            now(),
        )
        val url = provider.authorizeUrl(providerId, state, callbackUri) ?: return StartResult.UnknownProvider
        return StartResult.Redirect(url)
    }

    private fun loopback(
        port: Int,
        query: String,
    ) = CallbackResult.Redirect("http://127.0.0.1:$port/?$query")

    suspend fun callback(
        providerId: String,
        code: String?,
        state: String?,
        error: String?,
        callbackUri: String,
    ): CallbackResult {
        val flow =
            state?.let { repository.consumeFlow(Secrets.hashToken(it), now()) }
                ?.takeIf { it.provider == providerId }
                ?: return CallbackResult.Failed("This sign-in link expired or was already used. Start again from co-write.")
        if (error != null || code.isNullOrBlank()) return loopback(flow.port, "error=access_denied")

        val identity =
            try {
                provider.fetchIdentity(providerId, code, callbackUri)
            } catch (e: OAuthFailure) {
                return loopback(flow.port, "error=provider_error")
            }

        val linked = repository.findIdentity(identity.provider, identity.subject)
        val user: User =
            when {
                flow.linkUserId != null && linked != null && linked.id != flow.linkUserId ->
                    return loopback(flow.port, "error=already_linked")
                flow.linkUserId != null && linked != null -> linked
                flow.linkUserId != null -> {
                    val owner = repository.userById(flow.linkUserId) ?: return loopback(flow.port, "error=account_gone")
                    if (!repository.linkIdentity(owner.id, identity)) return loopback(flow.port, "error=already_linked")
                    owner
                }
                linked != null -> linked
                else -> createAccount(identity) ?: return loopback(flow.port, "error=signup_failed")
            }

        val oneTime = Secrets.randomId(32)
        repository.saveCode(Secrets.hashToken(oneTime), user.id, flow.codeChallenge, now() + codeLifetime.inWholeMilliseconds, now())
        return loopback(flow.port, "code=$oneTime")
    }

    /** A new account named after the provider login, made unique with a short suffix when it is taken. */
    private suspend fun createAccount(identity: OAuthIdentity): User? {
        val base =
            identity.login
                .lowercase()
                .replace(Regex("[^a-z0-9_.-]"), "-")
                .trim('-', '.')
                .take(24)
                .ifEmpty { "user" }
                .let { if (it.length < 2) "$it-$it" else it }
        repeat(MAX_ATTEMPTS) { attempt ->
            val candidate = if (attempt == 0) base else "$base-${Secrets.randomId(3).lowercase().filter { it.isLetterOrDigit() }.take(4)}"
            val user = auth.createKeylessUser(candidate) ?: return@repeat
            if (repository.linkIdentity(user.id, identity)) return user
            return null
        }
        return null
    }

    /** Redeems the one-time code with the PKCE verifier. The code is spent even when the verifier is wrong. */
    suspend fun exchange(
        code: String,
        verifier: String,
    ): AuthResult {
        val stored =
            repository.consumeCode(Secrets.hashToken(code), now())
                ?: return AuthResult.Rejected("This sign-in code expired or was already used.")
        if (!Pkce.matches(verifier, stored.codeChallenge)) return AuthResult.Rejected("The PKCE verifier does not match.")
        return auth.startSession(stored.user)
    }

    suspend fun identities(user: User): List<OAuthIdentity> = repository.identitiesOf(user.id)

    /** Unlinks a provider, unless it is the account's last way to sign in. */
    suspend fun unlink(
        user: User,
        providerId: String,
    ): UnlinkResult {
        if (repository.identitiesOf(user.id).none { it.provider == providerId }) return UnlinkResult.NotFound
        if (auth.signInMethodCount(user) <= 1) return UnlinkResult.LastMethod
        return if (repository.unlink(user.id, providerId)) UnlinkResult.Done else UnlinkResult.NotFound
    }
}
