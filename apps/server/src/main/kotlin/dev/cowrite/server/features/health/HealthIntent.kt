package dev.cowrite.server.features.health

import kotlinx.coroutines.CancellationException

/** Everything that can be asked about health, and everything that happens as a result. */
class HealthIntents(
    private val repository: HealthRepository,
    private val version: String,
) {
    suspend fun check(): HealthState =
        try {
            repository.pingDatabase()
            HealthState.Up(version)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            HealthState.Degraded(version, e.message ?: e::class.simpleName ?: "unknown error")
        }
}
