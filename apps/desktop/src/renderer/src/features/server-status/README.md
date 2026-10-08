# Feature layout (MVI + Repository)

Every feature has the same four files. Imports flow one way: `view → intent → (model, repository)`.

| File            | Role                                                                                                 | May import               |
| --------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| `model.ts`      | Zustand store, one immutable state at a time, guarded by a DFA (`createDfaModel`). No I/O, no logic. | `kit/`                   |
| `view.tsx`      | Passive. Renders `model` state; turns user events into intents.                                      | `model`, `intent`, UI    |
| `intent.ts`     | Everything else: decides, calls the repository, computes the next state and moves the model.         | `model`, `repository`    |
| `repository.ts` | The **only** code that touches the outside world (HTTP, WebSocket, `window.api`, storage).           | nothing from the feature |

ESLint enforces this (`eslint.config.js`). Repositories are injected into intents via a `create…Intents(deps)`
factory so intents are tested with fakes and no network.
