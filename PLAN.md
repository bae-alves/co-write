# co-write — Plan

A desktop-first collaborative Markdown editor with live preview ("Overleaf, but Markdown").
Derived from the design conversation: https://chatgpt.com/share/6ac7aeb9-5adc-83e9-81a5-30eedd82ad1c

License: AGPL-3.0 (see `LICENSE`).

## Status

**v1 is done** (Phases 0–5, PR #1 and the follow-up on `main`): a three-column Electron editor (files, source, preview) on Yjs, a Ktor relay persisting to PostgreSQL with lossless compaction, per-document roles, presence, and Linux packages. The git history has the details.

**Phases 6–9 are done too**, along with tabs and more file types: many files open in tabs over the source and preview columns; Markdown, RTF, PDF and the simple text formats (JSON, YAML, TOML, XML, …) each get the columns that make sense; the server runs from a container, with accounts that are Ed25519 keys (plus GitHub / OIDC) or with no accounts at all, and the desktop picks its server at runtime. What each phase added, and where it deviates from what was planned, is noted under [Phases](#phases).

## Guiding rule after v1

> **Anyone can run their own co-write: one container plus PostgreSQL, configured by environment variables. The desktop app points at whichever server you choose.**

Self-hosting works the way Stirling-PDF does: `docker compose up`, nothing else to set up. No official, central server is assumed anywhere in the code. Two ways to run an instance:

- **`AUTH=none`: no accounts, fully offline.** For a home server, a LAN or a VPN: no sign-in, every document open to everyone who can reach the server, no outbound network calls. People pick a display name for their cursor and start writing.
- **`AUTH=accounts`** (the default): key-based accounts, optional OAuth, per-document roles. For anything reachable from the internet.

## Decisions

| Topic           | Decision                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client priority | **Electron-first.** The restricted environment (filesystem, IPC, security boundary, offline) is the harder constraint; a web client later is a _deliberate reduction of capabilities_, not the base design.                                                                                                                                                                |
| Platform        | **Linux only.** AppImage and .deb; no macOS/Windows code paths or targets. Other platforms are left to people's own builds.                                                                                                                                                                                                                                                |
| Distribution    | Desktop: AppImage + .deb attached to GitHub Releases on every `v*` tag. **No auto-update.** Server: a container image on GHCR, self-hosted with `docker compose`.                                                                                                                                                                                                          |
| Renderer        | TypeScript, React, Vite, Tailwind CSS, shadcn/ui; CodeMirror 6 (not Monaco, not a `<textarea>`).                                                                                                                                                                                                                                                                           |
| Layout          | **Overleaf-style columns: files, then tabs over source and preview.** Each column can be toggled from the top left (`Ctrl+B` / `Ctrl+Shift+E` / `Ctrl+Shift+V`); source or preview always stays. The tab strip spans source and preview, so a PDF (preview only) still has tabs. No plugin system.                                                                         |
| File types      | One registry (`packages/shared/src/filetypes.ts`) says what opens and how: Markdown and RTF → source + preview; PDF → preview only, read-only; every other simple text format (JSON, YAML, TOML, XML, CSV, `.env`, code, …) → source only, highlighted by `@codemirror/language-data`. A shared document takes its type from its title. HTML is text here, never rendered. |
| Tabs            | Each tab keeps its own session alive (editor, undo history, draft, remote sync), so switching is instant and background tabs keep syncing. The `document` model describes the active tab; `useTabs` lists them. Closing a tab keeps unsaved drafts on the machine, as switching files always did.                                                                          |
| Server choice   | **Chosen at runtime** (`settings.json`, or `CO_WRITE_SERVER` as a preselection); the CSP's `connect-src` follows it and every window reloads on change. Sessions are kept per server. Main probes a server (`GET /api/instance`) before it is chosen, since the renderer's CSP only reaches the current one.                                                               |
| Theme           | WolfRose Dark only (not themeable yet). Every colour is a token in `styles.css`; the CodeMirror theme mirrors the VS Code theme.                                                                                                                                                                                                                                           |
| Icon            | The Markdown mark in white (public domain, svgrepo.com): `apps/desktop/resources/icon.svg`, with `icon.png` (512²) rendered from it via `rsvg-convert`.                                                                                                                                                                                                                    |
| Collaboration   | Yjs (`Y.Doc` / `Y.Text`) over WebSocket; CRDT semantics stay on the client. Zustand for app/UI state, Yjs for document state, no abstraction layer around Yjs.                                                                                                                                                                                                             |
| Preview         | Client-side only: `remark` + `rehype`, sanitized, rendered to React elements. Never send rendered HTML through the collab layer.                                                                                                                                                                                                                                           |
| Ktor's role     | Auth, authorization, document rooms, WebSocket relay, persistence. It does **not** understand Markdown or merge CRDT state.                                                                                                                                                                                                                                                |
| Persistence     | Raw Yjs update log per document plus snapshots supplied by clients. A snapshot replaces log entries only once the server has verified it contains every edit in them (`kit/YUpdate.kt`), so the current state is never lost. History beyond the latest snapshot is not kept.                                                                                               |
| Data layer      | **Plain JDBC + HikariCP** behind repositories, SQL migrations in `resources/db/`. Exposed/jOOQ: closed, not needed.                                                                                                                                                                                                                                                        |
| Auth            | **Key-based accounts (Ed25519) plus optional OAuth (GitHub, any OIDC provider). No passwords anywhere.** Instances can also run with **no auth at all** (`AUTH=none`). Sessions are opaque tokens, hashed at rest, 30 days; WebSockets connect with single-use tickets, never the token.                                                                                   |
| Renderer origin | Packaged builds serve the renderer from `app://co-write`: a real origin for CORS and the IPC sender check, and asset reads confined to the renderer folder.                                                                                                                                                                                                                |
| Y.Doc in MVI    | The `document` feature's repository owns the `Y.Doc`, provider and persistence; its model is a DFA over `empty → loading → local \| connecting ⇄ synced ⇄ offline → closed`.                                                                                                                                                                                               |

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

### Phase 6 — Self-hosting and releases — done

- [x] App icon: white Markdown mark in the window, the AppImage and the .deb.
- [x] **File mode / folder mode.** `co-write notes.md` (or double-clicking it) opens just that file: the files column starts hidden (without changing the remembered layout), only that file may be read or written, and only it is watched. Showing the files column offers "Open the … folder", which switches the window to folder mode. `co-write <folder>` and Open Folder… go straight to folder mode. Launching again opens a new window in the same process; the packages register the supported MIME types (Markdown, plain text, JSON, YAML, TOML, XML, RTF, PDF).
- [x] `pnpm install:local` (in `apps/desktop`): installs into `~/.local` without root, adds the launcher entry and icon, and makes co-write the default app for Markdown (offered under "Open with" for the other types, never made their default).
- [x] `apps/server/Dockerfile`: multi-stage (Gradle `installDist` → JRE 21 runtime), non-root user, `HEALTHCHECK` on `/health` over bash's `/dev/tcp` (the image has no curl), all configuration from environment variables. CI builds it on every push.
- [x] **`AUTH=none` mode.** Every connection is an editor of every document, the document list shows all documents, and member / owner routes, accounts, tickets and OAuth answer 404. The one built-in user is `@everyone` (not a valid username, so nobody can register it). A warning is logged at start. `GET /api/instance` returns `{ auth, oauth, version }`; with `none` the desktop shows only a display name (kept locally, used for presence) and never sign-in.
- [x] Fully offline: the image bundles everything it needs, the server makes no outbound calls with `AUTH=none` (OAuth providers are ignored there; with accounts, OAuth is the only outbound traffic), and the desktop loads nothing remote.
- [x] `deploy/docker-compose.yml`: the server image plus PostgreSQL with a named volume; the instance's settings in one `.env` (`deploy/.env.example`), with `AUTH` as the first setting. The root `docker-compose.yml` stays for development.
- [x] Runtime server choice in the desktop app (replaces the build-time URL): the status bar's server icon asks for the address, main checks it is a co-write server, then every window reloads under a CSP that allows exactly that origin. Sign-in is offered only if the instance uses accounts; credentials are stored per server.
- [x] `.github/workflows/release.yml` on `v*` tags: builds the AppImage and .deb and attaches them to a GitHub Release; builds and pushes the server image to `ghcr.io/bae-alves/co-write-server` (`:vX.Y.Z` and `:latest`). `publish: null` in `electron-builder.yml` writes no update metadata.
- [x] README: "Run your own server" and "Install the app".

### Phase 7 — Key-based accounts (replace passwords) — done

- [x] **Keys:** Ed25519. The desktop generates a key pair in the main process (`node:crypto`) and keeps the private key encrypted with `safeStorage`; where there is no OS keychain it is a file only its owner can read, and the UI says so. Importing and exporting a key as PKCS#8 PEM is supported through native file dialogs. The server verifies signatures with the JDK's built-in Ed25519, so no new dependency.
- [x] **Register:** username + public key (SPKI PEM), plus a signature over a fresh challenge that names the username, to prove possession.
- [x] **Sign in:** `POST /api/auth/challenge` returns a random, single-use nonce that expires after 60 s. The client signs `co-write-login\n<server origin>\n<nonce>`, so a signature cannot be replayed against another server (or reused to register). A valid signature returns the same kind of opaque session token as before (hashed at rest, 30 days). Main builds the text itself, for the configured server only: the renderer can neither read the key nor get a signature over anything else.
- [x] **Several keys per account** (one per machine). A signed-in device adds a key (paste its public key) and removes keys; removing a key ends the sessions created with it. **No server-side recovery:** losing every key means losing the account, unless it is linked to OAuth. The last way to sign in cannot be removed.
- [x] Migration `V2`: drop the password columns, add `account_keys` and `login_challenges`. Existing password accounts are dropped, since nothing is deployed.
- [x] Desktop: the account dialog shows the key's fingerprint and offers create, import, export, copy; the IPC gets `keys.sign` (and info / generate / import / export), validated like every other channel.
- [x] Tests: signature verification against keys generated by Node (`ed25519-fixtures.json`, generator committed alongside; `packages/shared` checks the same texts), expired / reused / foreign-origin challenges, key removal ending its sessions.

### Phase 8 — OAuth — done

- [x] **GitHub first, then generic OIDC.** Each instance registers its own OAuth app and sets `OAUTH_GITHUB_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_SECRET`, or `OAUTH_OIDC_ISSUER` / `OAUTH_OIDC_CLIENT_ID` / `OAUTH_OIDC_CLIENT_SECRET` (discovery document + userinfo endpoint), so instances can use Google, GitLab, Keycloak and others without code. A provider with missing settings is not offered.
- [x] **Flow:** the desktop listens on a random `127.0.0.1` port and opens `<server>/api/oauth/<provider>/start?port=…&code_challenge=<PKCE>` in the system browser. The server does the provider round-trip with its own callback, so the client secret never leaves it, then redirects to `http://127.0.0.1:<port>/?code=…` with a one-time code, which the desktop exchanges with its PKCE verifier for a session token. The loopback listener answers only the exact host and path, and gives up after five minutes.
- [x] **Linking:** an OAuth identity signing in for the first time creates an account; a signed-in user links with a one-time link intent instead (the browser carries the intent, never a token). Accounts can have keys, identities or both, and always keep at least one; an identity belongs to one account.
- [x] Tests: the full flow against a fake provider; PKCE mismatch, reused and expired one-time codes, forged state, linking, unlinking (the last sign-in method cannot be removed); the loopback listener in `oauth.test.ts`.

### Phase 9 — Session hardening and account lifecycle — done

- [x] **WebSocket tickets:** `POST /api/ws-ticket` (authenticated) returns a ticket for one document that is valid once and for 30 s. The socket connects with `?ticket=`, so the session token never appears in a URL or a proxy log; the token is not accepted there at all. The desktop fetches a fresh ticket for every (re)connect and takes over y-websocket's reconnecting to do so.
- [x] **Role changes apply immediately:** changing a member's role closes their open sockets with a reconnectable code (4001), and the reconnect picks up the new role; removing a member (new `DELETE /api/docs/{id}/members/{username}`) ends with 4403, and no ticket is issued to them again.
- [x] **Rate limiting:** Ktor's `RateLimit` plugin, per client IP, on the challenge, sign-in, registration, OAuth and ticket endpoints (`RATE_LIMIT_PER_MINUTE`). `TRUST_PROXY=true` makes the server read the IP from `X-Forwarded-For` behind a reverse proxy.
- [x] **Account deletion:** `DELETE /api/me` removes keys, OAuth links, sessions and memberships, closes the user's open sockets, and deletes the documents the user owns. The desktop lists them before confirming and asks for the username. Added for "transfer ownership first to keep them": `PUT /api/docs/{id}/owner`, with a "Hand over" button in the same dialog.
- [x] Tests for each, including a role change during a live session and an end-to-end run with real Yjs clients against a running server.

### Later (not scheduled)

- Server-side multi-file projects (a shared _folder_), images and other assets, rename/delete conflict semantics.
- Restoring a window's open tabs after a restart; reordering tabs by dragging; a text layer (selection, search) in the PDF viewer.
- Comments/annotations, document history/versioning (this would also make forged snapshots recoverable).
- Web client as a capability-reduced build of the same renderer, served by the same container.
- Themes other than WolfRose Dark (the tokens are ready).

## Open questions

- Which of the "Later" items comes first after Phase 9?
- OAuth providers beyond GitHub + generic OIDC: any that must be first-class?
