package dev.cowrite.server.features.collab

import dev.cowrite.server.features.auth.AuthIntents
import dev.cowrite.server.features.documents.Access
import dev.cowrite.server.features.documents.DocumentsIntents
import io.ktor.server.routing.Route
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readBytes
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicLong

/** Close codes in the 4400–4499 range tell y-websocket not to reconnect (mirrors @co-write/shared). */
object CollabCloseCode {
    const val UNAUTHENTICATED: Short = 4401
    const val FORBIDDEN: Short = 4403
    const val NOT_FOUND: Short = 4404
}

/** Frames queued for one slow client before it is disconnected. */
private const val OUTBOX_CAPACITY = 4096

private val peerIds = AtomicLong()

/**
 * `/ws/docs/{id}?token=…`: authenticates, checks the caller's role, then hands frames to the
 * room. Outgoing frames go through a bounded queue so one slow client never stalls a room.
 */
fun Route.collabRoutes(
    collab: CollabIntents,
    documents: DocumentsIntents,
    auth: AuthIntents,
) {
    webSocket("/ws/docs/{id}") {
        val user = auth.authenticate(call.request.queryParameters["token"])
        if (user == null) return@webSocket close(CloseReason(CollabCloseCode.UNAUTHENTICATED, "Sign in again."))
        val documentId = call.parameters["id"].orEmpty()
        val role =
            when (val access = documents.access(user, documentId)) {
                is Access.Granted -> access.role
                Access.NotFound -> return@webSocket close(CloseReason(CollabCloseCode.NOT_FOUND, "No such document."))
                Access.Forbidden -> return@webSocket close(CloseReason(CollabCloseCode.FORBIDDEN, "No access."))
            }

        val outbox = Channel<ByteArray>(OUTBOX_CAPACITY)
        val writer = launch { for (frame in outbox) send(Frame.Binary(true, frame)) }
        val peer =
            object : Peer {
                override val id = peerIds.incrementAndGet()

                override fun send(frame: ByteArray) {
                    if (outbox.trySend(frame).isFailure) {
                        outbox.close()
                        launch { close(CloseReason(CloseReason.Codes.TRY_AGAIN_LATER, "Too slow.")) }
                    }
                }
            }

        collab.join(documentId, peer, role.canWrite)
        try {
            for (frame in incoming) {
                if (frame is Frame.Binary) collab.receive(documentId, peer, frame.readBytes())
            }
        } finally {
            // Runs even when the session is cancelled (e.g. the socket died mid-write), so the
            // room never keeps a dead peer.
            withContext(NonCancellable) { collab.leave(documentId, peer) }
            outbox.close()
            writer.cancel()
        }
    }
}
