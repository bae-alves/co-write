package dev.cowrite.server.features.health

/** What the server knows about its own health. Immutable; a new value per check. */
sealed interface HealthState {
    val version: String

    data class Up(
        override val version: String,
    ) : HealthState

    data class Degraded(
        override val version: String,
        val reason: String,
    ) : HealthState
}
