package dev.cowrite.server.features.auth

import dev.cowrite.server.AuthMode
import dev.cowrite.server.kit.Ed25519
import dev.cowrite.server.kit.Secrets
import dev.cowrite.server.kit.SignedMessages
import java.util.Base64
import kotlin.time.Duration
import kotlin.time.Duration.Companion.days
import kotlin.time.Duration.Companion.seconds

/**
 * Key-based accounts and sessions: a client proves it holds an Ed25519 private key by signing a
 * single-use challenge. There are no passwords. In `AUTH=none` mode there are no accounts at all
 * and every caller is the one built-in user.
 */
class AuthIntents(
    private val repository: AuthRepository,
    private val mode: AuthMode = AuthMode.ACCOUNTS,
    private val now: () -> Long = System::currentTimeMillis,
    private val sessionLifetime: Duration = 30.days,
    private val challengeLifetime: Duration = 60.seconds,
    /** Called after an account is gone, e.g. to close its open sockets. */
    private val onAccountDeleted: suspend (User) -> Unit = {},
) {
    companion object {
        private val USERNAME = Regex("^[a-z0-9_.-]{2,32}$")
        const val MAX_LABEL = 64

        /** The built-in user of an `AUTH=none` instance. Not a valid username, so nobody can register it. */
        const val OPEN_USERNAME = "@everyone"

        /** Usernames are case-insensitive; they are stored lower-case. */
        fun normalize(username: String): String = username.trim().lowercase()
    }

    val isOpen: Boolean get() = mode == AuthMode.NONE

    private val decoder = Base64.getUrlDecoder()

    @Volatile private var openUser: User? = null

    /** The built-in user, created on first use. */
    suspend fun openUser(): User =
        openUser ?: (
            repository.findUser(OPEN_USERNAME)
                ?: (repository.createUser(OPEN_USERNAME, null) as? CreateUserOutcome.Created)?.user
                ?: checkNotNull(repository.findUser(OPEN_USERNAME))
        ).also { openUser = it }

    suspend fun startSession(
        user: User,
        keyId: Long? = null,
    ): AuthResult.SignedIn {
        val token = Secrets.randomId(32)
        repository.createSession(Secrets.hashToken(token), user.id, keyId, now() + sessionLifetime.inWholeMilliseconds)
        return AuthResult.SignedIn(user, token)
    }

    suspend fun issueChallenge(): Challenge {
        val nonce = Secrets.randomId(32)
        val expiresAt = now() + challengeLifetime.inWholeMilliseconds
        repository.saveChallenge(Secrets.hashToken(nonce), expiresAt, now())
        return Challenge(nonce, expiresAt)
    }

    private fun parseKey(
        pem: String,
        label: String,
    ): Pair<NewKey?, String?> =
        try {
            val der = Ed25519.parsePublicKey(pem)
            NewKey(der, Ed25519.fingerprint(der), label.trim().take(MAX_LABEL)) to null
        } catch (e: Ed25519.InvalidKey) {
            null to e.message
        }

    private fun decodeSignature(signature: String): ByteArray? = runCatching { decoder.decode(signature) }.getOrNull()

    /** Creates the account with its first key, proven by signing the challenge for this username. */
    suspend fun register(
        origin: String,
        rawUsername: String,
        publicKey: String,
        nonce: String,
        signature: String,
    ): AuthResult {
        val username = normalize(rawUsername)
        if (!USERNAME.matches(username)) {
            return AuthResult.Invalid("Usernames are 2–32 characters: letters, digits, '.', '_' or '-'.")
        }
        val (key, problem) = parseKey(publicKey, "")
        if (key == null) return AuthResult.Invalid(problem ?: "Invalid public key.")
        val signed = decodeSignature(signature) ?: return AuthResult.Rejected("The signature is not valid base64url.")
        if (!repository.consumeChallenge(Secrets.hashToken(nonce), now())) {
            return AuthResult.Rejected("The sign-in request expired or was already used. Try again.")
        }
        val message = SignedMessages.register(origin, nonce, username).encodeToByteArray()
        if (!Ed25519.verify(key.publicKey, message, signed)) {
            return AuthResult.Rejected("The signature does not match the key (or the server address it was made for).")
        }
        return when (val created = repository.createUser(username, key)) {
            CreateUserOutcome.UsernameTaken -> AuthResult.UsernameTaken
            CreateUserOutcome.KeyTaken -> AuthResult.KeyTaken
            is CreateUserOutcome.Created -> startSession(created.user, created.keyId)
        }
    }

    /** Signs in with any one of the account's keys. */
    suspend fun login(
        origin: String,
        rawUsername: String,
        nonce: String,
        signature: String,
    ): AuthResult {
        val signed = decodeSignature(signature) ?: return AuthResult.Rejected("The signature is not valid base64url.")
        if (!repository.consumeChallenge(Secrets.hashToken(nonce), now())) {
            return AuthResult.Rejected("The sign-in request expired or was already used. Try again.")
        }
        val failed = AuthResult.Rejected("No key of that account signed this request.")
        val user = repository.findUser(normalize(rawUsername)) ?: return failed
        val message = SignedMessages.login(origin, nonce).encodeToByteArray()
        val key = repository.keysOf(user.id).firstOrNull { Ed25519.verify(it.publicKey, message, signed) } ?: return failed
        return startSession(user, key.id)
    }

    /** The user a bearer token belongs to, or null if it is unknown or expired. */
    suspend fun authenticate(token: String?): User? {
        if (isOpen) return openUser()
        if (token.isNullOrBlank() || token.length > 512) return null
        return repository.findSession(Secrets.hashToken(token), now())
    }

    suspend fun logout(token: String) {
        repository.deleteSession(Secrets.hashToken(token))
    }

    suspend fun keys(user: User): List<StoredKey> = repository.keysOf(user.id)

    /** Adds another machine's public key, e.g. pasted from its export. */
    suspend fun addKey(
        user: User,
        publicKey: String,
        label: String,
    ): AddKeyResult {
        val (key, problem) = parseKey(publicKey, label)
        if (key == null) return AddKeyResult.Invalid(problem ?: "Invalid public key.")
        val stored = repository.addKey(user.id, key, now()) ?: return AddKeyResult.Duplicate
        return AddKeyResult.Added(stored)
    }

    /** Removing a key also ends the sessions created with it. The last way to sign in stays. */
    suspend fun removeKey(
        user: User,
        keyId: Long,
    ): RemoveKeyResult {
        if (repository.keysOf(user.id).none { it.id == keyId }) return RemoveKeyResult.NotFound
        if (repository.signInMethodCount(user.id) <= 1) return RemoveKeyResult.LastMethod
        return if (repository.removeKey(user.id, keyId)) RemoveKeyResult.Removed else RemoveKeyResult.NotFound
    }

    /** An account with no key yet (created by an OAuth sign-in); null when the username is taken. */
    suspend fun createKeylessUser(username: String): User? =
        (repository.createUser(username, null) as? CreateUserOutcome.Created)?.user

    suspend fun signInMethodCount(user: User): Int = repository.signInMethodCount(user.id)

    /** Deletes the account with its keys, OAuth links, sessions, memberships and owned documents. */
    suspend fun deleteAccount(user: User) {
        repository.deleteUser(user.id)
        onAccountDeleted(user)
    }
}
