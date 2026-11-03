package dev.cowrite.server

import dev.cowrite.server.kit.SignedMessages
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.origin

/**
 * The origin clients signed for: `PUBLIC_URL` when it is set, otherwise the one this request came
 * in on (honouring `X-Forwarded-*` when `TRUST_PROXY=true`).
 */
fun ApplicationCall.serverOrigin(config: AppConfig): String {
    config.publicUrl?.let { url -> SignedMessages.normalizeOrigin(url)?.let { return it } }
    val origin = request.origin
    return SignedMessages.normalizeOrigin("${origin.scheme}://${origin.serverHost}:${origin.serverPort}") ?: "unknown"
}
