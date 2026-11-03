package dev.cowrite.server

import io.ktor.server.plugins.ratelimit.RateLimitName

/** Per client IP: challenge, sign-in, registration, OAuth start / exchange and ticket requests. */
val AUTH_LIMIT = RateLimitName("auth")
