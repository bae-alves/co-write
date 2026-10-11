package dev.cowrite.server.features.auth

data class User(
    val id: Long,
    val username: String,
)

/** A user as stored, with their password hash. Never leaves the auth feature. */
data class StoredUser(
    val user: User,
    val passwordHash: String,
)

/** Outcome of register / login. */
sealed interface AuthResult {
    data class SignedIn(
        val user: User,
        val token: String,
    ) : AuthResult

    data class Invalid(
        val reason: String,
    ) : AuthResult

    data object WrongCredentials : AuthResult

    data object UsernameTaken : AuthResult
}
