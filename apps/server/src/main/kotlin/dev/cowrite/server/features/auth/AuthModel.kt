package dev.cowrite.server.features.auth

data class User(
    val id: Long,
    val username: String,
)

/** A public key to register: Ed25519, SPKI DER, with its fingerprint and a label for humans. */
class NewKey(
    val publicKey: ByteArray,
    val fingerprint: String,
    val label: String,
)

/** A registered key as stored. The public key itself stays on the server. */
class StoredKey(
    val id: Long,
    val publicKey: ByteArray,
    val fingerprint: String,
    val label: String,
    val createdAt: Long,
)

/** A fresh single-use nonce a client signs to register or sign in. */
data class Challenge(
    val nonce: String,
    val expiresAt: Long,
)

/** Outcome of creating an account (and its first key, when it has one). */
sealed interface CreateUserOutcome {
    data class Created(
        val user: User,
        val keyId: Long?,
    ) : CreateUserOutcome

    data object UsernameTaken : CreateUserOutcome

    data object KeyTaken : CreateUserOutcome
}

/** Outcome of register / login / OAuth exchange. */
sealed interface AuthResult {
    data class SignedIn(
        val user: User,
        val token: String,
    ) : AuthResult

    data class Invalid(
        val reason: String,
    ) : AuthResult

    /** The challenge was unknown, expired or used, or the signature did not match. */
    data class Rejected(
        val reason: String,
    ) : AuthResult

    data object UsernameTaken : AuthResult

    data object KeyTaken : AuthResult
}

sealed interface AddKeyResult {
    data class Added(
        val key: StoredKey,
    ) : AddKeyResult

    data class Invalid(
        val reason: String,
    ) : AddKeyResult

    data object Duplicate : AddKeyResult
}

sealed interface RemoveKeyResult {
    data object Removed : RemoveKeyResult

    data object NotFound : RemoveKeyResult

    /** Removing it would leave the account with no way to sign in. */
    data object LastMethod : RemoveKeyResult
}
