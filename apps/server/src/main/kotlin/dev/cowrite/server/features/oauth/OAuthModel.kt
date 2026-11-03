package dev.cowrite.server.features.oauth

import dev.cowrite.server.features.auth.User

/** Who a provider says someone is. `subject` is the provider's stable id; `login` is for display. */
data class OAuthIdentity(
    val provider: String,
    val subject: String,
    val login: String,
)

/** A provider round-trip in progress: where to send the one-time code, and the PKCE challenge it is bound to. */
data class Flow(
    val provider: String,
    val port: Int,
    val codeChallenge: String,
    /** Set when a signed-in user is linking the provider instead of signing in with it. */
    val linkUserId: Long?,
)

/** A one-time code waiting to be exchanged, with the user it signs in. */
data class StoredCode(
    val user: User,
    val codeChallenge: String,
)

sealed interface StartResult {
    data class Redirect(
        val url: String,
    ) : StartResult

    data object UnknownProvider : StartResult

    data class Invalid(
        val reason: String,
    ) : StartResult
}

sealed interface CallbackResult {
    /** Send the browser here: the desktop's loopback listener, with `?code=` or `?error=`. */
    data class Redirect(
        val url: String,
    ) : CallbackResult

    /** No loopback to go back to (the flow is unknown or expired): show this message. */
    data class Failed(
        val message: String,
    ) : CallbackResult
}

sealed interface UnlinkResult {
    data object Done : UnlinkResult

    data object NotFound : UnlinkResult

    data object LastMethod : UnlinkResult
}

/** The provider refused or answered with something unusable. */
class OAuthFailure(
    message: String,
) : Exception(message)
