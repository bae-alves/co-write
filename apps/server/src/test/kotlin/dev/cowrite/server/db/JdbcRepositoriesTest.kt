package dev.cowrite.server.db

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import dev.cowrite.server.features.auth.JdbcAuthRepository
import dev.cowrite.server.features.collab.JdbcCollabRepository
import dev.cowrite.server.features.documents.JdbcDocumentsRepository
import dev.cowrite.server.features.documents.Role
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.TestInstance
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The JDBC repositories against a real PostgreSQL. Skipped unless `TEST_DATABASE_URL` points at
 * a database the tests may wipe, e.g.
 * `TEST_DATABASE_URL=jdbc:postgresql://localhost:5432/cowrite_test ./gradlew test`.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class JdbcRepositoriesTest {
    private val url: String? = System.getenv("TEST_DATABASE_URL")
    private lateinit var dataSource: HikariDataSource

    @BeforeAll
    fun connect() {
        assumeTrue(url != null, "TEST_DATABASE_URL not set")
        dataSource =
            HikariDataSource(
                HikariConfig().apply {
                    jdbcUrl = url
                    username = System.getenv("TEST_DATABASE_USER") ?: "cowrite"
                    password = System.getenv("TEST_DATABASE_PASSWORD") ?: "cowrite"
                    maximumPoolSize = 2
                },
            )
    }

    @AfterAll
    fun disconnect() {
        if (::dataSource.isInitialized) dataSource.close()
    }

    @BeforeEach
    fun freshSchema() {
        dataSource.connection.use { connection ->
            connection.createStatement().use {
                it.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            }
        }
        SchemaRepository(dataSource).migrate()
    }

    @Test
    fun `migrations run once`() {
        assertEquals(emptyList(), SchemaRepository(dataSource).migrate())
    }

    @Test
    fun `users and sessions`() =
        runBlocking {
            val auth = JdbcAuthRepository(dataSource)
            val ana = auth.createUser("ana", "hash")!!
            assertNull(auth.createUser("ana", "other"), "usernames are unique")
            assertEquals("hash", auth.findUser("ana")!!.passwordHash)

            val token = byteArrayOf(1, 2, 3)
            auth.createSession(token, ana.id, expiresAt = 2_000)
            assertEquals(ana, auth.findSession(token, now = 1_000))
            assertNull(auth.findSession(token, now = 3_000), "expired")
            auth.deleteSession(token)
            assertNull(auth.findSession(token, now = 1_000))
        }

    @Test
    fun `documents and members`() =
        runBlocking {
            val auth = JdbcAuthRepository(dataSource)
            val docs = JdbcDocumentsRepository(dataSource)
            val ana = auth.createUser("ana", "h")!!
            val bo = auth.createUser("bo", "h")!!

            val doc = docs.create("d1", "Plan", ana.id, now = 5_000)
            assertEquals("ana", doc.owner)
            assertEquals(Role.OWNER, docs.roleOf("d1", ana.id))
            assertNull(docs.roleOf("d1", bo.id))
            assertTrue(docs.exists("d1"))

            docs.setMember("d1", docs.userIdOf("bo")!!, Role.VIEWER)
            docs.setMember("d1", bo.id, Role.EDITOR)
            assertEquals(Role.EDITOR, docs.roleOf("d1", bo.id))
            assertEquals(listOf("d1"), docs.listFor(bo.id).map { it.id })
            assertEquals(5_000, docs.listFor(bo.id).single().updatedAt)
        }

    @Test
    fun `update log append, load and compaction`() =
        runBlocking {
            val auth = JdbcAuthRepository(dataSource)
            val docs = JdbcDocumentsRepository(dataSource)
            val log = JdbcCollabRepository(dataSource)
            val ana = auth.createUser("ana", "h")!!
            docs.create("d1", "Plan", ana.id, now = 0)

            log.append("d1", 1, byteArrayOf(1), now = 10)
            log.append("d1", 2, byteArrayOf(2), now = 20)
            log.append("d1", 3, byteArrayOf(3), now = 30)
            assertEquals(listOf(1L, 2L, 3L), log.load("d1").map { it.seq })
            assertEquals(30, docs.listFor(ana.id).single().updatedAt, "appends touch updated_at")

            log.compact("d1", upTo = 2, snapshot = byteArrayOf(1, 2))
            val after = log.load("d1")
            assertEquals(listOf(2L, 3L), after.map { it.seq })
            assertContentEquals(byteArrayOf(1, 2), after.first().data)

            // Compacting an empty prefix (seq 0) works too.
            log.compact("d1", upTo = 0, snapshot = byteArrayOf(0))
            assertEquals(listOf(0L, 2L, 3L), log.load("d1").map { it.seq })
        }
}
