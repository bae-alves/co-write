# Feature layout (MVI + Repository)

Every feature has the same files. Imports flow one way: `view → intent → (model, repository)`.

| File            | Role                                                                                                 | May import               |
| --------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| `model.ts`      | Zustand store, one immutable state at a time, guarded by a DFA (`createDfaModel`). No I/O, no logic. | `kit/`                   |
| `view.tsx`      | Passive. Renders `model` state; turns user events into intents.                                      | `model`, `intent`, UI    |
| `intent.ts`     | Everything else: decides, calls the repository, computes the next state and moves the model.         | `model`, `repository`    |
| `repository.ts` | The **only** code that touches the outside world (HTTP, WebSocket, `window.api`, storage).           | nothing from the feature |

ESLint enforces this (`eslint.config.js`). Repositories are injected into intents via a `create…Intents(deps)`
factory so intents are tested with fakes and no network. A feature without outside-world access has no
repository (`preview`); one without state of its own has no model (`commands`). Intents may call other
features' intents and read their models; that is how features cooperate.

| Feature         | What it owns                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workbench`     | Which of the three columns (files, source, preview) are visible, limited to what the active file has (a PDF has no source, JSON no preview); the open dialog.                                                                                                                                                                               |
| `project`       | The local folder opened through main: the tree of files it can open, new files, on-disk changes.                                                                                                                                                                                                                                            |
| `document`      | The open tabs and their sessions. Each tab's session owns a `Y.Doc` (or, for a PDF, just its bytes), the y-websocket provider (reconnecting with a fresh ticket each time) and the local persistence; `useDocument` is a DFA over the active tab's `local` / `viewing` / `connecting` / `synced` / `offline` / …, `useTabs` lists the tabs. |
| `preview`       | What the preview column shows for the active tab: a sanitized HTML tree (Markdown or RTF) and which source line to keep in view, or a PDF with its zoom.                                                                                                                                                                                    |
| `account`       | Sign-in state and the session token (stored encrypted by main, per server): a key's signed challenge, a provider, or just a display name on an open instance.                                                                                                                                                                               |
| `security`      | The signed-in account's keys, linked providers and deletion (the account dialog).                                                                                                                                                                                                                                                           |
| `shared-docs`   | The server's document list for the signed-in user: create, publish a local file, invite.                                                                                                                                                                                                                                                    |
| `commands`      | Routes native menu commands to the intents above.                                                                                                                                                                                                                                                                                           |
| `server-status` | The reference slice: which server is chosen, is it up, and what is it (accounts or open, which providers)?                                                                                                                                                                                                                                  |

Shared HTTP plumbing (`apiRequest`, `desktopApi`) lives in `src/server/repository.ts`.
