package dev.cowrite.server

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Enforces MVI + Repository by source inspection (the server's counterpart of the desktop ESLint rules).
 *
 *  - Only `*Repository.kt` may touch the outside world (JDBC, Hikari, HTTP clients).
 *  - `*Model.kt` is pure: no Ktor, no repositories, no intents.
 *  - `*Route.kt` (the view) never uses repositories; it goes through intents.
 *  - `*Intent.kt` knows nothing about Ktor.
 */
class ArchitectureTest {
    private val sources =
        File("src/main/kotlin").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    private fun importsOf(file: File): List<String> =
        file.readLines().filter { it.startsWith("import ") }.map { it.removePrefix("import ").trim() }

    private fun violations(
        suffix: String,
        forbidden: List<String>,
    ): List<String> =
        sources
            .filter { it.name.endsWith("$suffix.kt") }
            .flatMap { file ->
                importsOf(file)
                    .filter { import -> forbidden.any { import.startsWith(it) || import.contains(it) } }
                    .map { "${file.name} imports $it" }
            }

    private val outsideWorld = listOf("java.sql", "javax.sql", "com.zaxxer", "org.postgresql", "io.ktor.client")

    @Test
    fun `only repositories touch the outside world`() {
        val offenders =
            sources
                .filterNot { it.name.endsWith("Repository.kt") || it.name == "Main.kt" }
                .flatMap { f -> importsOf(f).filter { i -> outsideWorld.any { i.startsWith(it) } }.map { "${f.name}: $it" } }
        assertTrue(offenders.isEmpty(), "Outside-world access outside a repository: $offenders")
    }

    @Test
    fun `models are pure`() {
        val bad = violations("Model", listOf("io.ktor", "Repository", "Intent"))
        assertTrue(bad.isEmpty(), "Model violations: $bad")
    }

    @Test
    fun `routes never use repositories`() {
        val bad = violations("Route", listOf("Repository"))
        assertTrue(bad.isEmpty(), "Route violations: $bad")
    }

    @Test
    fun `intents know nothing about ktor`() {
        val bad = violations("Intent", listOf("io.ktor"))
        assertTrue(bad.isEmpty(), "Intent violations: $bad")
    }

    @Test
    fun `sources were found`() {
        assertTrue(sources.any { it.name == "HealthModel.kt" }, "Architecture test found no sources")
    }
}
