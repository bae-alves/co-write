# co-write — Plan

A desktop-first collaborative Markdown editor with live preview ("Overleaf, but Markdown").
Derived from the design conversation: https://chatgpt.com/share/6ac7aeb9-5adc-83e9-81a5-30eedd82ad1c

License: AGPL-3.0 (see `LICENSE`).

## Status

**v1 is done** (Phases 0–5, PR #1 and the follow-up on `main`): a three-column Electron editor (files, source, preview) on Yjs, a Ktor relay persisting to PostgreSQL with lossless compaction, per-document roles, presence, and Linux packages. The git history has the details. This plan now covers what comes after v1.

## Guiding rule after v1

> **Anyone can run their own co-write: one container plus PostgreSQL, configured by environment variables. The desktop app points at whichever server you choose.**

Self-hosting works the way Stirling-PDF does: `docker compose up`, nothing else to set up. No official, central server is assumed anywhere in the code. Two ways to run an instance:

- **`AUTH=none`: no accounts, fully offline.** For a home server, a LAN or a VPN: no sign-in, every document open to everyone who can reach the server, no outbound network calls. People pick a display name for their cursor and start writing.
- **`AUTH=accounts`** (the default): key-based accounts, optional OAuth, per-document roles. For anything reachable from the internet.

## Decisions

| Topic           | Decision                                                                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client priority | **Electron-first.** The restricted environment (filesystem, IPC, security boundary, offline) is the harder constraint; a web client later is a _deliberate reduction of capabilities_, not the base design.                                                                  |
| Platform        | **Linux only.** AppImage and .deb; no macOS/Windows code paths or targets. Other platforms are left to people's own builds.                                                                                                                                                  |
| Distribution    | Desktop: AppImage + .deb attached to GitHub Releases on every `v*` tag. **No auto-update.** Server: a container image on GHCR, self-hosted with `docker compose`.                                                                                                            |
| Renderer        | TypeScript, React, Vite, Tailwind CSS, shadcn/ui; CodeMirror 6 (not Monaco, not a `<textarea>`).                                                                                                                                                                             |
| Layout          | **Overleaf-style three columns: files, source, preview.** Each can be toggled from the top left (`Ctrl+B` / `Ctrl+Shift+E` / `Ctrl+Shift+V`); source or preview always stays. No tabs, no plugin system.                                                                     |
| Theme           | WolfRose Dark only (not themeable yet). Every colour is a token in `styles.css`; the CodeMirror theme mirrors the VS Code theme.                                                                                                                                             |
| Icon            | The Markdown mark in white (public domain, svgrepo.com): `apps/desktop/resources/icon.svg`, with `icon.png` (512²) rendered from it via `rsvg-convert`.                                                                                                                      |
| Collaboration   | Yjs (`Y.Doc` / `Y.Text`) over WebSocket; CRDT semantics stay on the client. Zustand for app/UI state, Yjs for document state, no abstraction layer around Yjs.                                                                                                               |
| Preview         | Client-side only: `remark` + `rehype`, sanitized, rendered to React elements. Never send rendered HTML through the collab layer.                                                                                                                                             |
| Ktor's role     | Auth, authorization, document rooms, WebSocket relay, persistence. It does **not** understand Markdown or merge CRDT state.                                                                                                                                                  |
| Persistence     | Raw Yjs update log per document plus snapshots supplied by clients. A snapshot replaces log entries only once the server has verified it contains every edit in them (`kit/YUpdate.kt`), so the current state is never lost. History beyond the latest snapshot is not kept. |
| Data layer      | **Plain JDBC + HikariCP** behind repositories, SQL migrations in `resources/db/`. Exposed/jOOQ: closed, not needed.                                                                                                                                                          |
| Auth            | v1 has username + password accounts. **They are replaced by key-based accounts (Phase 7) plus OAuth (Phase 8).** No passwords anywhere after that. Instances can also run with **no auth at all** (`AUTH=none`, Phase 6).                                                    |
| Renderer origin | Packaged builds serve the renderer from `app://co-write`: a real origin for CORS and the IPC sender check, and asset reads confined to the renderer folder.                                                                                                                  |
| Y.Doc in MVI    | The `document` feature's repository owns the `Y.Doc`, provider and persistence; its model is a DFA over `empty → loading → local \| connecting ⇄ synced ⇄ offline → closed`.                                                                                                 |

Accepted risk: snapshots come from editors' clients, and the server checks that they are complete, not that they are honest. A malicious editor could forge one, but editors can already delete everything, and sharing a document is a matter of trust between people who know each other.

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
- Intents take their repository via a factory, so they are tested against fakes with no network or database.

## Architecture

```text
Electron
├── main/       window lifecycle, filesystem, native menus, persistence, keys, IPC handlers
├── preload/    narrow, typed API exposed as window.api (contextBridge)
└── renderer/   React + CodeMirror 6 + Yjs + Zustand + Tailwind + shadcn/ui
                      │
                 WebSocket (Yjs updates) to the server the user chose
                      │
           co-write container (Ktor) ── PostgreSQL
```

### Electron security boundary (holds for everything below)

- `contextIsolation`, no `nodeIntegration`, `sandbox` for every renderer; the renderer reaches nothing but `window.api`.
- The preload exposes a small typed surface; main validates every IPC payload (zod) and checks the sender frame; file access is confined to the user-picked root.
- Strict CSP; navigation, `window.open`, `<webview>` and permission requests denied; preview HTML sanitized.
- **New:** private keys live only in the main process. The renderer can ask main to sign a login challenge, never to read a key.

### Collaboration data flow

```text
CodeMirror ⇄ y-codemirror.next ⇄ Y.Text ⇄ Y.Doc ⇄ WS provider ⇄ Ktor ⇄ PostgreSQL
```

- Undo/redo uses `Y.UndoManager`, so undo only reverts _local_ changes.
- Cursors, selections and presence use Yjs awareness, never stored in the document.
- The server relays binary updates per room, persists the log and verified snapshots, and answers the sync handshake from the stored log.

## Phases

### Phase 6 — Self-hosting and releases

- [x] App icon: white Markdown mark in the window, the AppImage and the .deb.
- [x] **File mode / folder mode.** `co-write notes.md` (or double-clicking it) opens just that file: the files column starts hidden (without changing the remembered layout), only that file may be read or written, and only it is watched. Showing the files column offers "Open the … folder", which switches the window to folder mode. `co-write <folder>` and Open Folder… go straight to folder mode. Launching again opens a new window in the same process; the packages register `text/markdown`.
- [x] `pnpm install:local` (in `apps/desktop`): installs into `~/.local` without root, adds the launcher entry and icon, and makes co-write the default app for Markdown.
- [ ] `apps/server/Dockerfile`: multi-stage (Gradle build → JRE 21 runtime), non-root user, `HEALTHCHECK` on `/health`, all configuration from the existing environment variables (`DATABASE_*`, `PORT`, `CORS_ALLOWED_HOSTS`, `COMPACT_AFTER`).
- [ ] **`AUTH=none` mode.** The server skips accounts and tokens: every connection is an editor of every document, the document list shows all documents, and inviting/roles are hidden. It logs a warning at startup that the instance must not be exposed publicly. `GET /api/instance` returns `{ auth: "none" | "accounts", oauth: [...] }`, so the desktop knows what to show: with `none` it asks only for a display name (stored locally, used for presence) and never shows sign-in. Accounts-only routes answer 404 in this mode. Phases 7–9 build on `accounts` mode and leave `none` untouched.
- [ ] Fully offline: the image bundles everything it needs, the server makes no outbound calls with `AUTH=none` (OAuth is the only outbound traffic at all), and the desktop app loads nothing remote.
- [ ] `deploy/docker-compose.yml`: the server image plus PostgreSQL with a named volume; the instance's settings in one `.env`, with `AUTH` as the first line. The root `docker-compose.yml` stays for development.
- [ ] Runtime server choice in the desktop app (replaces the build-time `MAIN_VITE_SERVER_URL`): connecting asks for the server URL first, then for sign-in only if the instance uses accounts; credentials are stored per server; the CSP's `connect-src` follows the chosen server.
- [ ] `.github/workflows/release.yml` on `v*` tags: builds the AppImage and .deb and attaches them to a GitHub Release; builds and pushes the server image to `ghcr.io/bae-alves/co-write-server` (`:vX.Y.Z` and `:latest`). `electron-builder` publishes no update metadata (no `latest-linux.yml`).
- [ ] README: "Run your own server" (compose file, `.env`, `AUTH=none` for a private network vs. `AUTH=accounts` behind a TLS reverse proxy for `wss://`) and "Install the app".

### Phase 7 — Key-based accounts (replace passwords)

- [ ] **Keys:** Ed25519. The desktop generates a key pair in the main process (`node:crypto`) and keeps the private key encrypted with `safeStorage`; importing and exporting an existing key as PEM (PKCS#8) is supported. The server verifies signatures with the JDK's built-in Ed25519 (`java.security`), so no new dependency.
- [ ] **Register:** username + public key (SPKI PEM), plus a signature over a fresh challenge to prove possession.
- [ ] **Sign in:** `POST /api/auth/challenge` returns a random, single-use nonce that expires after 60 s. The client signs `co-write-login\n<server origin>\n<nonce>`, so a signature cannot be replayed against another server. A valid signature returns the same kind of opaque session token as today (hashed at rest, 30 days).
- [ ] **Several keys per account** (one per machine). A signed-in device can add a key (paste or import its public key) and remove keys; removing a key is how rotation works, and it ends the sessions created with that key. **No server-side recovery:** losing every key means losing the account, unless it is linked to OAuth (Phase 8).
- [ ] Migration `V2`: drop the password columns, add `account_keys` and `login_challenges`. Existing password accounts are dropped, since nothing is deployed.
- [ ] Desktop: the account dialog shows the key's fingerprint and offers generate, import and export; the IPC gets `keys.sign(challenge)`, validated like every other channel.
- [ ] Tests: signature verification against keys generated by Node (fixtures, like `yjs-fixtures.json`), expired/reused/foreign-origin challenges, key removal ending its sessions.

### Phase 8 — OAuth

- [ ] **GitHub first.** Each instance registers its own OAuth app and sets `OAUTH_GITHUB_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_SECRET`; the provider is hidden when they are unset. A generic OIDC provider (`OAUTH_OIDC_*`) comes next, so instances can use Google, GitLab, Keycloak and others without code.
- [ ] **Flow:** the desktop opens the system browser at `<server>/api/oauth/github/start?port=<loopback port>&code_challenge=<PKCE>`. The server does the provider round-trip with its own callback, so the client secret never leaves the server. It then redirects to `http://127.0.0.1:<port>/` with a one-time code, which the desktop exchanges together with its PKCE verifier for a session token.
- [ ] **Linking:** an OAuth identity signed in for the first time creates an account; when the user is already signed in, it is linked to that account instead. Accounts can have keys, OAuth identities or both, and must always keep at least one.
- [ ] Tests: the full flow against a fake provider; PKCE mismatch, reused one-time codes, linking and unlinking (the last sign-in method cannot be removed).

### Phase 9 — Session hardening and account lifecycle

- [ ] **WebSocket tickets:** `POST /api/ws-ticket` (authenticated) returns a ticket for one document that is valid once and for 30 s. The socket connects with `?ticket=`, so the session token never appears in a URL or a proxy log.
- [ ] **Role changes apply immediately:** changing a member's role closes their open sockets with a reconnectable code, and the reconnect picks up the new role; removing a member (new `DELETE /api/docs/{id}/members/{username}`) ends with 4403 as today.
- [ ] **Rate limiting:** Ktor's `RateLimit` plugin, per client IP, on the challenge, sign-in, OAuth and ticket endpoints. `TRUST_PROXY=true` makes the server read the IP from `X-Forwarded-For` behind a reverse proxy.
- [ ] **Account deletion:** `DELETE /api/me` removes keys, OAuth links, sessions and memberships. Documents the user owns alone are deleted with the account; the desktop says so and lists them before confirming. Transfer ownership first to keep them.
- [ ] Tests for each, including a role change during a live session.

### Later (not scheduled)

- Server-side multi-file projects (a shared _folder_), images and other assets, rename/delete conflict semantics.
- Comments/annotations, document history/versioning (this would also make forged snapshots recoverable).
- Web client as a capability-reduced build of the same renderer, served by the same container.
- Themes other than WolfRose Dark (the tokens are ready).

## Open questions

- Which of the "Later" items comes first after Phase 9?
- OAuth providers beyond GitHub + generic OIDC: any that must be first-class?
