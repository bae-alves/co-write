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

| Feature         | What it owns                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workbench`     | Which of the three columns (files, source, preview) are visible; the open dialog.                                                                                                            |
| `project`       | The local folder opened through main: its Markdown tree, new files, on-disk changes.                                                                                                         |
| `document`      | The open document's session. Its repository owns the `Y.Doc`, the y-websocket provider and the local persistence; the model is a DFA over `local` / `connecting` / `synced` / `offline` / …. |
| `preview`       | The sanitized HTML tree of the open document, and which source line to keep in view.                                                                                                         |
| `account`       | Sign-in state and the session token (stored encrypted by main).                                                                                                                              |
| `shared-docs`   | The server's document list for the signed-in user: create, publish a local file, invite.                                                                                                     |
| `commands`      | Routes native menu commands to the intents above.                                                                                                                                            |
| `server-status` | The reference slice: is the Ktor server up?                                                                                                                                                  |

Shared HTTP plumbing (`apiRequest`, `desktopApi`) lives in `src/server/repository.ts`.
