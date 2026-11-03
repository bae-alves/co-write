# co-write

A desktop-first collaborative editor with live preview: Overleaf, but for Markdown and the other
plain-text formats. Files on the left, tabs over source and preview in the middle, each column
toggled from the top left. See [PLAN.md](PLAN.md) for the architecture and roadmap.

- **Local folders.** Open a folder, edit its files in tabs, save with `Ctrl+S`. Unsaved drafts survive restarts.
- **Many formats.** Markdown and RTF are edited with a live preview; PDFs open in the preview column alone; JSON, YAML, TOML, XML, plain text, CSV, source code and other simple text formats open in the source column with syntax highlighting and no preview.
- **Shared documents.** Connect to your co-write server, share a file or create a document, invite editors or viewers. Edits sync live (Yjs CRDT) with cursors and presence, and keep working offline.
- **Your server, your rules.** There is no official server. Run your own with `docker compose up`, with accounts that are keys on your machines, or with no accounts at all on a private network.

## File types

| Kind                                                                         | Columns          | Preview                                          |
| ---------------------------------------------------------------------------- | ---------------- | ------------------------------------------------ |
| Markdown (`.md`, `.markdown`, …)                                             | source + preview | rendered Markdown, kept in step as you scroll    |
| RTF (`.rtf`)                                                                 | source + preview | paragraphs, bold / italic / underline, alignment |
| PDF (`.pdf`)                                                                 | preview only     | the pages; read-only; zoom                       |
| JSON, YAML, TOML, XML (and SVG, plist, RSS…), INI, `.env`, CSV, logs, `.txt` | source only      | none                                             |
| Source code (`.ts`, `.py`, `.rs`, `.go`, `.sh`, `Dockerfile`, `Makefile`, …) | source only      | none                                             |

A shared document takes its type from its title: a document called `config.yaml` is edited as YAML,
one called `Meeting notes` as Markdown. File managers offer co-write under "Open with" for these
types; only Markdown is made the default.

## Prerequisites

Node 22+, pnpm 10, JDK 21, Docker (for PostgreSQL).

## Develop

```sh
pnpm install
docker compose up -d postgres      # PostgreSQL on :5432
pnpm server:run                    # Ktor on :8080, migrates the database (see apps/server/.env.example)
CO_WRITE_SERVER=http://localhost:8080 pnpm dev   # Electron + Vite (see apps/desktop/.env.example)
```

The desktop app chooses its server at runtime (the server icon in the status bar). `CO_WRITE_SERVER`
only preselects one, until you choose another.

| Shortcut                   | Action                     |
| -------------------------- | -------------------------- |
| `Ctrl+O`                   | Open folder                |
| `Ctrl+N`                   | New file in the folder     |
| `Ctrl+S`                   | Save the local file        |
| `Ctrl+W`                   | Close the tab              |
| `Ctrl+PageDown` / `PageUp` | Next / previous tab        |
| `Ctrl+B`                   | Toggle the files column    |
| `Ctrl+Shift+E`             | Toggle the source column   |
| `Ctrl+Shift+V`             | Toggle the preview column  |
| `Ctrl+F`                   | Find / replace in the file |

## Run your own server

A server is one container plus PostgreSQL, configured by environment variables. The desktop app
connects to whichever one you give it.

```sh
cd deploy
cp .env.example .env               # set POSTGRES_PASSWORD, AUTH and PUBLIC_URL
docker compose up -d
```

`deploy/docker-compose.yml` runs `ghcr.io/bae-alves/co-write-server` and PostgreSQL with a named
volume. The first line of `.env` is the choice that matters:

- **`AUTH=none`: a private network** (home server, LAN, VPN). No sign-in: everyone who can reach the
  server is an editor of every document, and people only pick a display name for their cursor. The
  server makes no outbound calls and logs a warning at start. **Never expose it to the internet.**
- **`AUTH=accounts`** (the default): accounts are Ed25519 keys that stay on each person's machine,
  with optional GitHub / OpenID Connect sign-in, and per-document roles (owner, editor, viewer).
  Put it behind a TLS reverse proxy so clients connect over `https://` and `wss://`, and set
  `PUBLIC_URL=https://write.example.com` and `TRUST_PROXY=true`.

Sign-in providers are optional: set `OAUTH_GITHUB_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_SECRET` (callback
`<PUBLIC_URL>/api/oauth/github/callback`) and/or `OAUTH_OIDC_ISSUER`, `OAUTH_OIDC_CLIENT_ID`,
`OAUTH_OIDC_CLIENT_SECRET` (callback `<PUBLIC_URL>/api/oauth/oidc/callback`). A provider whose
settings are missing is simply not offered.

In the app, click the server icon in the status bar, enter the server's address, and (with
accounts) choose a username: the first time, this machine's key is created and registered. To use
the same account from a second computer, either export the key from the first one and import it on
the second, or create a key there and add its public key under your account.

## Install the app

Releases attach a Linux AppImage and a `.deb` to each tag on GitHub. There is no auto-update.

```sh
# From a checkout, without root: installs into ~/.local, adds a launcher entry and icon,
# and makes co-write the default app for Markdown.
cd apps/desktop && pnpm install:local
co-write notes.md                  # one file; `co-write ~/notes` opens a folder
```

## Check

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # desktop + shared
pnpm server:test                                         # server; set TEST_DATABASE_URL to also run the JDBC tests
CO_WRITE_E2E_SERVER=http://localhost:8080 pnpm test:e2e  # real Yjs clients against a running server
```

## Package

```sh
pnpm package                       # Linux AppImage + .deb into apps/desktop/dist (Linux is the only target)
docker build -t co-write-server apps/server              # the server image
```

## Layout

```text
apps/desktop      Electron: src/main (privileged), src/preload (window.api), src/renderer (React)
apps/server       Ktor: accounts, documents, WebSocket rooms, PostgreSQL (and its Dockerfile)
packages/shared   IPC and API contracts, file types, signed texts: shared by main, preload and renderer
deploy            docker-compose.yml + .env.example for running a server
```

## License

[AGPL-3.0](LICENSE)
