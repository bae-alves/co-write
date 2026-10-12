# co-write

A desktop-first collaborative Markdown editor with live preview: Overleaf, but for Markdown.
Three columns (files, source, preview), each toggled from the top left. See [PLAN.md](PLAN.md)
for the architecture and roadmap.

- **Local folders.** Open a folder, edit its Markdown files, save with `Ctrl+S`. Unsaved drafts survive restarts.
- **Shared documents.** Sign in to your co-write server, share a file or create a document, invite editors or viewers. Edits sync live (Yjs CRDT) with cursors and presence, and keep working offline.

## Prerequisites

Node 22+, pnpm 10, JDK 21, Docker (for PostgreSQL).

## Develop

```sh
pnpm install
docker compose up -d postgres      # PostgreSQL on :5432
pnpm server:run                    # Ktor on :8080, migrates the database (see apps/server/.env.example)
pnpm dev                           # Electron + Vite (see apps/desktop/.env.example)
```

| Shortcut       | Action                     |
| -------------- | -------------------------- |
| `Ctrl+O`       | Open folder                |
| `Ctrl+N`       | New file in the folder     |
| `Ctrl+S`       | Save the local file        |
| `Ctrl+B`       | Toggle the files column    |
| `Ctrl+Shift+E` | Toggle the source column   |
| `Ctrl+Shift+V` | Toggle the preview column  |
| `Ctrl+F`       | Find / replace in the file |

## Check

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # desktop + shared
pnpm server:test                                         # server; set TEST_DATABASE_URL to also run the JDBC tests
CO_WRITE_E2E_SERVER=http://localhost:8080 pnpm test:e2e  # real Yjs clients against a running server
```

## Package

```sh
pnpm package                       # Linux AppImage + .deb into apps/desktop/dist (Linux is the only target)
```

## Layout

```text
apps/desktop      Electron: src/main (privileged), src/preload (window.api), src/renderer (React)
apps/server       Ktor: auth, documents, WebSocket rooms, PostgreSQL
packages/shared   IPC and API contracts shared by main, preload and renderer
```

## License

[AGPL-3.0](LICENSE)
