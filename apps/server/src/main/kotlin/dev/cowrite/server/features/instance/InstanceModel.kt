package dev.cowrite.server.features.instance

import dev.cowrite.server.AuthMode

data class OAuthProviderInfo(
    val id: String,
    val label: String,
)

/** What a client needs to know before it signs in: whether there are accounts, and which providers. */
data class InstanceInfo(
    val auth: AuthMode,
    val oauth: List<OAuthProviderInfo>,
    val version: String,
)
