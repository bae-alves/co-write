import { create, type StoreApi, type UseBoundStore } from 'zustand'

/** A model state is a discriminated union member; `tag` names the DFA state. */
export interface Tagged {
  readonly tag: string
}

/** The DFA's edge table: for every state, the states it may move to. */
export type Edges<Tag extends string> = Readonly<Record<Tag, readonly Tag[]>>

export class IllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal transition: ${from} -> ${to}`)
    this.name = 'IllegalTransitionError'
  }
}

export interface DfaModel<S extends Tagged> {
  /** Current state. Never mutated; every transition produces a new object. */
  readonly state: S
  /** Whether the DFA has an edge from the current state to `tag`. */
  can(tag: S['tag']): boolean
  /** Move to `next`. Throws {@link IllegalTransitionError} if the edge doesn't exist. */
  go(next: S): void
}

/**
 * A Model is a zustand store holding one immutable state at a time, guarded by a DFA.
 * It knows which transitions are legal and nothing else: no I/O, no business logic.
 * Intents compute the next state (and its data) and hand it over via `go`.
 */
export function createDfaModel<S extends Tagged>(
  initial: S,
  edges: Edges<S['tag']>,
): UseBoundStore<StoreApi<DfaModel<S>>> {
  const allowed = (from: S['tag'], to: S['tag']): boolean => edges[from].includes(to)

  return create<DfaModel<S>>()((set, get) => ({
    state: Object.freeze({ ...initial }),
    can: (tag) => allowed(get().state.tag, tag),
    go: (next) => {
      const from = get().state.tag
      if (!allowed(from, next.tag)) throw new IllegalTransitionError(from, next.tag)
      set({ state: Object.freeze({ ...next }) })
    },
  }))
}
