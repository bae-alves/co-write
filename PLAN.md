# co-write — Plan

A desktop-first collaborative Markdown editor with live preview ("Overleaf, but Markdown").
Derived from the design conversation: https://chatgpt.com/share/6ac7aeb9-5adc-83e9-81a5-30eedd82ad1c

License: AGPL-3.0 (see `LICENSE`).

## Decisions taken from the conversation

| Topic           | Decision                                                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client priority | **Electron-first.** The restricted environment (filesystem, IPC, security boundary, offline) is the harder constraint (Boehm spiral); a web client later is a _deliberate reduction of capabilities_, not the base design. |
| Renderer        | TypeScript, React, Vite, Tailwind CSS, shadcn/ui                                                                                                                                                                           |
| Editor          | CodeMirror 6 (not Monaco, not a `<textarea>`)                                                                                                                                                                              |
| Collaboration   | Yjs (`Y.Doc` / `Y.Text`) + WebSocket provider; CRDT semantics stay on the client                                                                                                                                           |
| State           | **Zustand for app/UI state; Yjs for document/collaboration state.** No abstraction layer around Yjs.                                                                                                                       |
| Backend         | Kotlin, Ktor, WebSockets, PostgreSQL (Exposed or jOOQ)                                                                                                                                                                     |
| Preview         | Client-side only: `remark` + `rehype`, sanitized HTML. Never send rendered HTML through the collab layer — collaborate on Markdown source.                                                                                 |
| Ktor's role     | Auth, authorization, document rooms, WebSocket relay, persistence. It does **not** understand Markdown or implement collaboration logic.                                                                                   |

## Code architecture: MVI + Repository (both ends)

Simplified but strict. Four roles per feature; imports flow one way: **view → intent → (model, repository)**.

| Role           | What it is                                                                                                                    | Desktop (TS)                                 | Server (Kotlin)                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| **Model**      | Immutable state, one value at a time, **DFA-guarded**: a state may only move along declared edges. No I/O, no business logic. | `model.ts` (zustand store, `createDfaModel`) | `*Model.kt` (sealed state types)                    |
| **View**       | Passive. Renders model state, turns user events into intents. No logic, no state of its own.                                  | `view.tsx`                                   | `*Route.kt` (parse request → intent → render state) |
| **Intent**     | Does _everything else_: decides, calls the repository, computes the next state, moves the model. No reducers.                 | `intent.ts` (`create…Intents(deps)`)         | `*Intent.kt`                                        |
| **Repository** | The **only** coupling to anything external (HTTP, WebSocket, `window.api`/IPC, storage, PostgreSQL). Injected into intents.   | `repository.ts`                              | `*Repository.kt` (+ JDBC impl)                      |

Enforced, not aspirational:

- **Desktop:** ESLint (`eslint.config.js`) forbids `fetch`/`WebSocket`/storage/`window.api` outside `repository.ts`, and forbids the wrong-way imports per role.
- **Server:** `ArchitectureTest` inspects imports (only `*Repository.kt` may import JDBC/Hikari/HTTP clients; models pure; routes never use repositories; intents know no Ktor).
- Intents take their repository via a factory (`createXIntents(deps)` / constructor), so they are tested against fakes with no network or database.

Reference slice (Phase 0): the `server-status` feature on the desktop and the `health` feature on the server.

## Guiding rule for v1

> **One Markdown document → CodeMirror → Y.Text → WebSocket → Ktor → persistence.**

Everything else (multi-file projects, comments, history, awareness polish) waits until this slice works end to end.

## Architecture

```text
Electron
├── main/       window lifecycle, filesystem, native menus, persistence, IPC handlers
├── preload/    narrow, typed API exposed as window.api (contextBridge)
└── renderer/   React + CodeMirror 6 + Yjs + Zustand + Tailwind + shadcn/ui
                      │
                 WebSocket (Yjs updates)
                      │
                    Ktor ── PostgreSQL
```

Proposed repo layout (monorepo):

```text
co-write/
├── apps/
│   ├── desktop/          # Electron: src/main, src/preload, src/renderer
│   └── server/           # Ktor (Gradle, Kotlin)
├── packages/
│   └── shared/           # IPC/WS message types, constants (TS) — created in Phase 1 with the IPC contract
├── docker-compose.yml    # PostgreSQL for local dev
├── LICENSE               # AGPL-3.0
└── PLAN.md
```

### Electron security boundary (Phase 1 deliverable)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for every renderer.
- Renderer has **no** Node/Electron access; only `window.api` from preload.
- Preload exposes a small typed surface (e.g. `openFile`, `saveFile`, `listProject`, `onFileChanged`); no raw `ipcRenderer`, no generic `invoke(channel, ...)`.
- Main validates every IPC payload (schema validation, e.g. zod), checks `event.senderFrame` origin, and restricts file access to the user-selected project root (resolve + reject path traversal/symlink escapes).
- Strict CSP; deny `window.open` / navigation; sanitize preview HTML (`rehype-sanitize`).
- Privileged operations stay visibly privileged in the architecture — don't abstract the Electron restrictions away prematurely.

### Collaboration data flow

```text
CodeMirror ⇄ y-codemirror.next binding ⇄ Y.Text ⇄ Y.Doc ⇄ WS provider ⇄ Ktor ⇄ PostgreSQL
```

- Local edits and remote edits both go through the Yjs binding; CodeMirror is unaware of peers.
- Undo/redo uses `Y.UndoManager` (via the binding), so undo only reverts _local_ changes, not remote ones.
- Ephemeral state (cursors, selections, presence) uses Yjs **awareness**, never stored in the document.
- Ktor relays binary Yjs updates per document room; persists updates/snapshots (compacted periodically); sends state on (re)connect via the Yjs sync protocol (state vector → missing updates).

## Phases

### Phase 0 — Scaffold

- [x] pnpm workspace, TS config, lint/format (ESLint + architecture rules, Prettier), CI (`.github/workflows/ci.yml`).
- [x] `apps/desktop`: Electron + electron-vite + React + Tailwind v4 + shadcn/ui, `server-status` reference feature (model/intent/repository/view + tests). Hardened window settings and CSP already in place. _Renderer verified in Chromium against the live server; the Electron shell builds but has not been launched (no GUI in the dev container)._
- [x] `apps/server`: Ktor + `/health` (reference `health` feature, tests, architecture test), Gradle wrapper, `docker-compose.yml` with PostgreSQL. _Verified end to end against a real PostgreSQL 16 (503 degraded → 200 up)._

### Phase 1 — Local editor + security boundary

- [ ] Main/preload/renderer split with the hardened settings above.
- [ ] Typed IPC contract in `packages/shared`; validated handlers in main.
- [ ] Open/save a single `.md` file via the main process.
- [ ] CodeMirror 6 with Markdown language support; live preview pane (remark/rehype, sanitized).
- [ ] Zustand store for UI/app state (open doc, settings, connection status).
- [ ] Tests: IPC validation, path-restriction logic.

### Phase 2 — Yjs locally

- [ ] Back the editor with `Y.Doc` / `Y.Text` via the CodeMirror–Yjs binding; undo/redo through `Y.UndoManager`.
- [ ] Persist Yjs state locally (main process) so offline editing survives restarts.
- [ ] Unit tests for local/remote update application and undo semantics (two in-memory `Y.Doc`s).

### Phase 3 — Ktor relay

- [ ] WebSocket endpoint `/ws/docs/{docId}`: room registry, join/leave, broadcast of binary updates.
- [ ] Yjs sync handshake (state vector / update exchange) on connect and **reconnect with backoff** on the client.
- [ ] Persistence: append updates to PostgreSQL, periodic compaction/snapshot, load on room open.
- [ ] Integration tests with two simulated clients, including a disconnect/reconnect with offline edits.

### Phase 4 — Auth & permissions

- [ ] Authentication (token-based) on WebSocket upgrade; per-document authorization (owner/editor/viewer).
- [ ] Document identity and basic document list API.
- [ ] Viewer role enforced server-side (drop updates from read-only sockets).

### Phase 5 — Presence & polish

- [ ] Awareness: remote cursors/selections, collaborator list (shadcn components).
- [ ] Connection status UI, native menus/shortcuts, window lifecycle.
- [ ] Packaging (electron-builder) for desktop targets.

### Later / explicitly out of scope for v1

- Multi-file projects and asset handling (images/diagrams), file rename/delete conflict semantics.
- Comments/annotations (`Y.Array`/`Y.Map`), document history/versioning.
- Web client as a capability-reduced build of the same renderer.

## Open questions

- Auth provider: self-managed accounts vs. OAuth?
- Persistence format: raw Yjs update log vs. periodic snapshots only?
- Target platforms for packaging (macOS / Windows / Linux)?
- Exposed vs. jOOQ for the Ktor data layer (Phase 0 uses plain JDBC + HikariCP behind the repository).
- Where the `Y.Doc` lives in MVI terms: proposal is that the editor feature's repository owns the `Y.Doc` + WebSocket provider, and the model holds only a DFA over the connection/session (`connecting → synced → offline …`); CodeMirror binds to the doc through the repository.
