package dev.cowrite.server.features.auth

import dev.cowrite.server.kit.Secrets
import kotlin.time.Duration
import kotlin.time.Duration.Companion.days

/** Accounts and sessions: register, log in, check a token, log out. */
class AuthIntents(
    private val repository: AuthRepository,
    private val now: () -> Long = System::currentTimeMillis,
    private val sessionLifetime: Duration = 30.days,
    private val hashPassword: (String) -> String = { Secrets.hashPassword(it) },
) {
    companion object {
        private val USERNAME = Regex("^[a-z0-9_.-]{2,32}$")
        const val MIN_PASSWORD = 8
        const val MAX_PASSWORD = 256

        /** Usernames are case-insensitive; they are stored lower-case. */
        fun normalize(username: String): String = username.trim().lowercase()
    }

    /** Spent on unknown usernames too, so response times do not reveal which names exist. */
    private val dummyHash by lazy { hashPassword("not a real password") }

    private fun validate(
        username: String,
        password: String,
    ): String? =
        when {
            !USERNAME.matches(username) -> "Usernames are 2–32 characters: letters, digits, '.', '_' or '-'."
            password.length < MIN_PASSWORD -> "Passwords need at least $MIN_PASSWORD characters."
            password.length > MAX_PASSWORD -> "Passwords can have at most $MAX_PASSWORD characters."
            else -> null
        }

    private suspend fun startSession(user: User): AuthResult.SignedIn {
        val token = Secrets.randomId(32)
        repository.createSession(Secrets.hashToken(token), user.id, now() + sessionLifetime.inWholeMilliseconds)
        return AuthResult.SignedIn(user, token)
    }

    suspend fun register(
        rawUsername: String,
        password: String,
    ): AuthResult {
        val username = normalize(rawUsername)
        validate(username, password)?.let { return AuthResult.Invalid(it) }
        val user = repository.createUser(username, hashPassword(password)) ?: return AuthResult.UsernameTaken
        return startSession(user)
    }

    suspend fun login(
        rawUsername: String,
        password: String,
    ): AuthResult {
        val stored = repository.findUser(normalize(rawUsername))
        if (stored == null) {
            Secrets.verifyPassword(password, dummyHash)
            return AuthResult.WrongCredentials
        }
        if (!Secrets.verifyPassword(password, stored.passwordHash)) return AuthResult.WrongCredentials
        return startSession(stored.user)
    }

    /** The user a bearer token belongs to, or null if it is unknown or expired. */
    suspend fun authenticate(token: String?): User? {
        if (token.isNullOrBlank() || token.length > 512) return null
        return repository.findSession(Secrets.hashToken(token), now())
    }

    suspend fun logout(token: String) {
        repository.deleteSession(Secrets.hashToken(token))
    }
}
