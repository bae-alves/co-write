package dev.cowrite.server.features.auth

import dev.cowrite.server.TEST_ORIGIN
import dev.cowrite.server.kit.SignedMessages
import io.ktor.client.HttpClient
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

/** An Ed25519 key pair, standing in for the desktop's key. */
class TestKey(
    private val pair: KeyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair(),
) {
    val publicDer: ByteArray get() = pair.public.encoded
    val pem: String =
        "-----BEGIN PUBLIC KEY-----\n" +
            Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(pair.public.encoded) +
            "\n-----END PUBLIC KEY-----\n"

    fun sign(message: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(
            Signature.getInstance("Ed25519").run {
                initSign(pair.private)
                update(message.encodeToByteArray())
                sign()
            },
        )
}

suspend fun HttpClient.postJson(
    path: String,
    body: String,
    token: String? = null,
): HttpResponse =
    post(path) {
        contentType(ContentType.Application.Json)
        token?.let { bearerAuth(it) }
        setBody(body)
    }

fun String.jsonField(name: String): String = Json.parseToJsonElement(this).jsonObject[name]!!.jsonPrimitive.content

suspend fun HttpClient.challenge(): String = postJson("/api/auth/challenge", "{}").bodyAsText().jsonField("nonce")

/** Registers `username` with `key` (a fresh one by default) and returns its session token. */
suspend fun HttpClient.register(
    username: String,
    key: TestKey = TestKey(),
    origin: String = TEST_ORIGIN,
): String {
    val nonce = challenge()
    val signature = key.sign(SignedMessages.register(origin, nonce, username.trim().lowercase()))
    val response =
        postJson(
            "/api/auth/register",
            """{"username":"$username","publicKey":${Json.encodeToString(String.serializer(), key.pem)},"nonce":"$nonce","signature":"$signature"}""",
        )
    check(response.status == HttpStatusCode.OK) { response.bodyAsText() }
    return response.bodyAsText().jsonField("token")
}

/** Signs in as `username` with `key`; returns the response (200 with a token, or why not). */
suspend fun HttpClient.login(
    username: String,
    key: TestKey,
    origin: String = TEST_ORIGIN,
): HttpResponse {
    val nonce = challenge()
    return postJson(
        "/api/auth/login",
        """{"username":"$username","nonce":"$nonce","signature":"${key.sign(SignedMessages.login(origin, nonce))}"}""",
    )
}

