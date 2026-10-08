# co-write

A desktop-first collaborative Markdown editor with live preview. See [PLAN.md](PLAN.md) for the architecture and roadmap.

## Prerequisites

Node 22+, pnpm 10, JDK 21, Docker (for PostgreSQL).

## Develop

```sh
pnpm install
docker compose up -d postgres      # PostgreSQL on :5432
pnpm server:run                    # Ktor on :8080  (see apps/server/.env.example)
pnpm dev                           # Electron + Vite (see apps/desktop/.env.example)
```

## Check

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # desktop
pnpm server:test                                         # server
```

## License

[AGPL-3.0](LICENSE)
