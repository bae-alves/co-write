package dev.cowrite.server.features.instance

/** Describes this instance. Its answer never changes while the server runs. */
class InstanceIntents(
    private val info: InstanceInfo,
) {
    fun describe(): InstanceInfo = info
}
