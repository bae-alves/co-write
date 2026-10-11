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

## Decisions taken while building v1

| Topic           | Decision                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout          | **Overleaf-style three columns: files, source, preview.** Each can be toggled from the top left (VS Code-style layout buttons, `Ctrl+B` / `Ctrl+Shift+E` / `Ctrl+Shift+V`); source or preview always stays. |
| Scope of the UI | Deliberately small: no tabs, no plugin system, no settings screen. Files column = the open local folder plus the server's shared documents.                                                                 |
| Theme           | WolfRose Dark only (not themeable yet). Every colour is a token in `styles.css`; the CodeMirror theme and syntax colours mirror the VS Code theme's `colors` / `tokenColors`.                               |
| Renderer origin | Packaged builds serve the renderer from `app://co-write` (custom privileged protocol), not `file://`: a real origin for CORS and the IPC sender check, and asset reads confined to the renderer folder.     |
| Auth            | Self-managed accounts. PBKDF2-HMAC-SHA256 password hashes; opaque random bearer tokens (30 days), stored only as SHA-256 hashes. The token is kept encrypted with Electron `safeStorage`.                   |
| Persistence     | Raw Yjs update log per document **plus snapshots supplied by clients** (see Phase 3). The server never merges CRDT state, so it needs no Yjs port.                                                          |
| Data layer      | Plain JDBC + HikariCP behind repositories, SQL migrations in `resources/db/` (no Exposed/jOOQ yet; nothing has needed them).                                                                                |
| Y.Doc in MVI    | As proposed: the `document` feature's repository owns the `Y.Doc`, provider and persistence; its model is a DFA over `empty → loading → local \| connecting ⇄ synced ⇄ offline → closed`.                   |

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
- [x] `apps/desktop`: Electron + electron-vite + React + Tailwind v4 + shadcn/ui, `server-status` reference feature (model/intent/repository/view + tests). Hardened window settings and CSP already in place. _Renderer verified in Chromium against the live server._
- [x] `apps/server`: Ktor + `/health` (reference `health` feature, tests, architecture test), Gradle wrapper, `docker-compose.yml` with PostgreSQL. _Verified end to end against a real PostgreSQL 16 (503 degraded → 200 up)._

### Phase 1 — Local editor + security boundary

- [x] Main/preload/renderer split with the hardened settings above. Plus: permission requests denied, `<webview>` blocked, all navigation blocked, renderer served from `app://co-write`.
- [x] Typed IPC contract in `packages/shared` (`CoWriteApi`, zod schemas); every handler checks the sender frame and parses its payload. The preload imports only the dependency-free channel list.
- [x] Open/save `.md` files via the main process — a whole folder, confined to the user-picked root (traversal, absolute paths, symlink and dangling-symlink escapes rejected; atomic writes; Markdown only). File-system changes are watched and pushed to the renderer.
- [x] CodeMirror 6 with Markdown (+ fenced code languages); live preview (remark-gfm → rehype-sanitize → React elements, never `innerHTML`), following the editor's scroll position.
- [x] Zustand DFA models for UI/app state (`workbench`, `project`, `document`, `preview`, `account`, `shared-docs`, `server-status`).
- [x] Tests: IPC validation and sender checks, path restriction, `app://` resolution, every intent against fakes.

### Phase 2 — Yjs locally

- [x] Editor backed by `Y.Doc` / `Y.Text` via y-codemirror.next; undo/redo through `Y.UndoManager` (disk loads, reloads and remote edits are not undoable).
- [x] Yjs state persisted by main (`userData/doc-state`, debounced). Local files keep unsaved drafts across restarts (dropped if the file changed on disk meanwhile); shared documents stay editable offline, and their list is cached.
- [x] Unit tests for local/remote update application, offline convergence and undo semantics (two in-memory `Y.Doc`s), and for the draft logic.

### Phase 3 — Ktor relay

- [x] `/ws/docs/{docId}`: room registry, join/leave, relay of binary updates, presence (awareness) relay with cleanup when a connection drops. Per-connection bounded outbox, so a slow client cannot stall a room.
- [x] Sync handshake without a server-side Yjs: a client's step 1 is answered with the stored log + an empty step 2; the server then sends step 1 with an empty state vector, and the client's full-state answer carries its offline edits. The client (y-websocket) reconnects with backoff.
- [x] Persistence: updates appended to PostgreSQL; the full-state answers above double as **snapshots** that replace the log prefix they cover (requested on every writer's join and after `COMPACT_AFTER` updates).
- [x] Tests: room logic with simulated peers; real WebSocket sessions (two clients, disconnect/reconnect with offline edits, compaction); JDBC repositories against PostgreSQL; and an end-to-end suite with real Yjs clients (`pnpm test:e2e`).

### Phase 4 — Auth & permissions

- [x] Token auth on the WebSocket upgrade (`?token=`); per-document roles owner/editor/viewer. Refusals use close codes 4401/4403/4404, which y-websocket treats as final.
- [x] Document identity (random 128-bit ids) and API: list, create, invite/change role (owner only).
- [x] Viewer role enforced server-side (updates and full states from read-only sockets are dropped) and in the editor (read-only).

### Phase 5 — Presence & polish

- [x] Awareness: remote cursors/selections with names (y-codemirror.next), collaborator avatars in the status bar.
- [x] Status bar (saved/unsaved, connecting/synced/offline, server health), native menus with shortcuts, window lifecycle.
- [x] Packaging: `electron-builder.yml` for macOS (dmg), Windows (nsis) and Linux (AppImage, deb). _Linux build produced and launched here; macOS/Windows untested; no icons or code signing yet._

### Later / explicitly out of scope for v1

- Server-side multi-file projects (a shared _folder_), asset handling (images/diagrams), file rename/delete conflict semantics. Local folders are in v1 because the files column needs them.
- Comments/annotations (`Y.Array`/`Y.Map`), document history/versioning.
- Web client as a capability-reduced build of the same renderer.
- Themes other than WolfRose Dark (the tokens are ready for it).

## Open questions

Answered while building: auth (self-managed accounts), persistence format (update log + client-supplied snapshots), Y.Doc placement (as proposed), packaging targets (configured for all three). Still open:

- OAuth / SSO on top of local accounts?
- Revoking access for a connected socket: role changes apply on the next connection today.
- Session token in the WebSocket query string (browsers cannot set headers on upgrade): fine over `wss://`, but a short-lived ticket endpoint would keep it out of proxy logs.
- Snapshots come from editors' clients; a malicious editor could submit a bogus full state. Editors can already delete everything, but history would need server-side Yjs to verify.
- Login rate limiting, account deletion, password change.
- Exposed vs. jOOQ, once queries outgrow plain JDBC.
- Signing/notarization and icons for the packaged apps.
