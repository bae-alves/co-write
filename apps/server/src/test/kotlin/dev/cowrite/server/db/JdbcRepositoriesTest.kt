package dev.cowrite.server.db

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import dev.cowrite.server.features.auth.CreateUserOutcome
import dev.cowrite.server.features.auth.JdbcAuthRepository
import dev.cowrite.server.features.auth.NewKey
import dev.cowrite.server.features.auth.User
import dev.cowrite.server.features.collab.JdbcCollabRepository
import dev.cowrite.server.features.documents.JdbcDocumentsRepository
import dev.cowrite.server.features.documents.Role
import dev.cowrite.server.features.oauth.Flow
import dev.cowrite.server.features.oauth.JdbcOAuthRepository
import dev.cowrite.server.features.oauth.OAuthIdentity
import dev.cowrite.server.features.tickets.JdbcTicketsRepository
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

    private fun key(seed: Int) = NewKey(byteArrayOf(seed.toByte(), 1, 2, 3), "SHA256:test$seed", "key $seed")

    private suspend fun JdbcAuthRepository.user(
        name: String,
        key: NewKey? = null,
    ): User = (createUser(name, key) as CreateUserOutcome.Created).user

    @Test
    fun `migrations run once`() {
        assertEquals(emptyList(), SchemaRepository(dataSource).migrate())
    }

    @Test
    fun `users, keys and sessions`() =
        runBlocking {
            val auth = JdbcAuthRepository(dataSource)
            val created = auth.createUser("ana", key(1)) as CreateUserOutcome.Created
            val ana = created.user
            assertEquals(CreateUserOutcome.UsernameTaken, auth.createUser("ana", key(2)), "usernames are unique")
            assertEquals(CreateUserOutcome.KeyTaken, auth.createUser("bo", key(1)), "a key belongs to one account")
            assertNull(auth.findUser("bo"), "a failed sign-up leaves no half-made account")
            assertEquals(ana, auth.findUser("ana"))
            assertEquals(1, auth.signInMethodCount(ana.id))

            val second = auth.addKey(ana.id, key(3), now = 5_000)!!
            assertNull(auth.addKey(ana.id, key(3), now = 5_000), "the same key twice")
            assertEquals(listOf("key 1", "key 3"), auth.keysOf(ana.id).map { it.label })
            assertEquals(5_000, second.createdAt)
            assertEquals(2, auth.signInMethodCount(ana.id))

            val token = byteArrayOf(1, 2, 3)
            auth.createSession(token, ana.id, second.id, expiresAt = 2_000)
            assertEquals(ana, auth.findSession(token, now = 1_000))
            assertNull(auth.findSession(token, now = 3_000), "expired")

            assertTrue(auth.removeKey(ana.id, second.id))
            assertNull(auth.findSession(token, now = 1_000), "removing a key ends the sessions made with it")
            assertTrue(auth.createUser("bo", null) is CreateUserOutcome.Created, "accounts without a key exist (OAuth)")

            val other = byteArrayOf(9)
            auth.createSession(other, ana.id, null, expiresAt = 2_000)
            auth.deleteSession(other)
            assertNull(auth.findSession(other, now = 1_000))
        }

    @Test
    fun `challenges, tickets and OAuth codes are single use and expire`() =
        runBlocking {
            val auth = JdbcAuthRepository(dataSource)
            val ana = auth.user("ana")
            val docs = JdbcDocumentsRepository(dataSource)
            docs.create("d1", "Plan", ana.id, now = 0)

            val nonce = byteArrayOf(5)
            auth.saveChallenge(nonce, expiresAt = 2_000, now = 1_000)
            assertTrue(auth.consumeChallenge(nonce, now = 1_500))
            assertTrue(!auth.consumeChallenge(nonce, now = 1_500), "single use")
            auth.saveChallenge(nonce, expiresAt = 2_000, now = 1_000)
            assertTrue(!auth.consumeChallenge(nonce, now = 2_500), "expired")

            val tickets = JdbcTicketsRepository(dataSource)
            val ticket = byteArrayOf(6)
            tickets.save(ticket, ana.id, "d1", expiresAt = 2_000, now = 1_000)
            assertNull(tickets.redeem(ticket, "other-doc", now = 1_500), "only for its own document")
            assertNull(tickets.redeem(ticket, "d1", now = 1_500), "and that attempt spent it")
            tickets.save(ticket, ana.id, "d1", expiresAt = 2_000, now = 1_000)
            assertEquals(ana, tickets.redeem(ticket, "d1", now = 1_500))
            assertNull(tickets.redeem(ticket, "d1", now = 1_500))

            val oauth = JdbcOAuthRepository(dataSource)
            val code = byteArrayOf(7)
            oauth.saveCode(code, ana.id, "challenge", expiresAt = 2_000, now = 1_000)
            assertEquals("challenge", oauth.consumeCode(code, now = 1_500)!!.codeChallenge)
            assertNull(oauth.consumeCode(code, now = 1_500))

            val state = byteArrayOf(8)
            oauth.saveFlow(state, Flow("github", 45_000, "c", linkUserId = ana.id), expiresAt = 2_000, now = 1_000)
            assertEquals(Flow("github", 45_000, "c", ana.id), oauth.consumeFlow(state, now = 1_500))
            assertNull(oauth.consumeFlow(state, now = 1_500))
            oauth.saveFlow(state, Flow("github", 45_000, "c", linkUserId = null), expiresAt = 2_000, now = 1_000)
            assertNull(oauth.consumeFlow(state, now = 1_500)!!.linkUserId)

            val intent = byteArrayOf(10)
            oauth.saveLinkIntent(intent, ana.id, expiresAt = 2_000, now = 1_000)
            assertEquals(ana.id, oauth.consumeLinkIntent(intent, now = 1_500))
            assertNull(oauth.consumeLinkIntent(intent, now = 1_500))
        }

    @Test
    fun `OAuth identities link to one account and count as a way to sign in`() =
        runBlocking {
            val auth = JdbcAuthRepository(dataSource)
            val oauth = JdbcOAuthRepository(dataSource)
            val ana = auth.user("ana", key(1))
            val bo = auth.user("bo")
            val identity = OAuthIdentity("github", "42", "octocat")

            assertTrue(oauth.linkIdentity(ana.id, identity))
            assertTrue(!oauth.linkIdentity(bo.id, identity), "already linked to ana")
            assertEquals(ana, oauth.findIdentity("github", "42"))
            assertEquals(listOf(identity), oauth.identitiesOf(ana.id))
            assertEquals(2, auth.signInMethodCount(ana.id))

            assertTrue(oauth.unlink(ana.id, "github"))
            assertNull(oauth.findIdentity("github", "42"))
            assertEquals(1, auth.signInMethodCount(ana.id))
        }

    @Test
    fun `deleting an account takes everything with it`() =
        runBlocking {
            val auth = JdbcAuthRepository(dataSource)
            val docs = JdbcDocumentsRepository(dataSource)
            val log = JdbcCollabRepository(dataSource)
            val oauth = JdbcOAuthRepository(dataSource)
            val tickets = JdbcTicketsRepository(dataSource)
            val ana = auth.user("ana", key(1))
            val bo = auth.user("bo", key(2))
            docs.create("mine", "Mine", ana.id, now = 0)
            docs.create("theirs", "Theirs", bo.id, now = 0)
            docs.setMember("theirs", ana.id, Role.EDITOR)
            log.append("mine", 1, byteArrayOf(1), now = 1)
            oauth.linkIdentity(ana.id, OAuthIdentity("github", "1", "ana"))
            auth.createSession(byteArrayOf(1), ana.id, null, expiresAt = 9_000)
            tickets.save(byteArrayOf(2), ana.id, "theirs", expiresAt = 9_000, now = 0)

            auth.deleteUser(ana.id)

            assertNull(auth.findUser("ana"))
            assertTrue(auth.keysOf(ana.id).isEmpty())
            assertTrue(!docs.exists("mine"), "documents the user owned go with them")
            assertTrue(log.load("mine").isEmpty())
            assertNull(docs.roleOf("theirs", ana.id), "memberships go")
            assertTrue(docs.exists("theirs"), "other people's documents stay")
            assertNull(oauth.findIdentity("github", "1"))
            assertNull(auth.findSession(byteArrayOf(1), now = 1))
            assertNull(tickets.redeem(byteArrayOf(2), "theirs", now = 1))
            assertEquals(listOf("bo"), listOf(auth.findUser("bo")!!.username))
        }

    @Test
    fun `documents and members`() =
        runBlocking {
            val auth = JdbcAuthRepository(dataSource)
            val docs = JdbcDocumentsRepository(dataSource)
            val ana = auth.user("ana")
            val bo = auth.user("bo")

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

            assertEquals(listOf("d1"), docs.listAll().map { it.id })
            assertEquals(Role.EDITOR, docs.listAll().single().role)

            assertTrue(docs.removeMember("d1", bo.id))
            assertTrue(!docs.removeMember("d1", bo.id))
            assertTrue(!docs.removeMember("d1", ana.id), "the owner's membership stays")
            assertNull(docs.roleOf("d1", bo.id))

            docs.setMember("d1", bo.id, Role.VIEWER)
            docs.transferOwnership("d1", ana.id, bo.id)
            assertEquals(Role.OWNER, docs.roleOf("d1", bo.id))
            assertEquals(Role.EDITOR, docs.roleOf("d1", ana.id))
            assertEquals("bo", docs.listFor(ana.id).single().owner)
        }

    @Test
    fun `update log append, load and compaction`() =
        runBlocking {
            val auth = JdbcAuthRepository(dataSource)
            val docs = JdbcDocumentsRepository(dataSource)
            val log = JdbcCollabRepository(dataSource)
            val ana = auth.user("ana")
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
