import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

/**
 * The CRDT semantics the editor relies on, with two in-memory peers wired back to back
 * (what the WebSocket relay does, minus the network).
 */
const LOCAL = Symbol('local edit') // stands in for the CodeMirror binding's origin
const REMOTE = Symbol('remote')

function peers() {
  const a = new Y.Doc()
  const b = new Y.Doc()
  let online = true
  const outboxA: Uint8Array[] = []
  const outboxB: Uint8Array[] = []
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return
    if (online) Y.applyUpdate(b, update, REMOTE)
    else outboxA.push(update)
  })
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return
    if (online) Y.applyUpdate(a, update, REMOTE)
    else outboxB.push(update)
  })
  return {
    a,
    b,
    textA: a.getText('content'),
    textB: b.getText('content'),
    disconnect: () => (online = false),
    reconnect: () => {
      online = true
      outboxA.splice(0).forEach((u) => Y.applyUpdate(b, u, REMOTE))
      outboxB.splice(0).forEach((u) => Y.applyUpdate(a, u, REMOTE))
    },
  }
}

const edit = (doc: Y.Doc, change: () => void) => doc.transact(change, LOCAL)

describe('Y.Text between two peers', () => {
  it('applies local edits remotely', () => {
    const { a, textA, textB } = peers()
    edit(a, () => textA.insert(0, '# Hello'))
    expect(textB.toString()).toBe('# Hello')
  })

  it('converges after concurrent offline edits, keeping both', () => {
    const { a, b, textA, textB, disconnect, reconnect } = peers()
    edit(a, () => textA.insert(0, 'line\n'))
    disconnect()
    edit(a, () => textA.insert(0, 'A '))
    edit(b, () => textB.insert(textB.length, 'B'))
    expect(textA.toString()).not.toBe(textB.toString())
    reconnect()
    expect(textA.toString()).toBe(textB.toString())
    expect(textA.toString()).toBe('A line\nB')
  })

  it('reaches the same state from a full-state snapshot as from the update log', () => {
    const { a, textA } = peers()
    edit(a, () => textA.insert(0, 'abc'))
    edit(a, () => textA.delete(1, 1))
    const late = new Y.Doc()
    Y.applyUpdate(late, Y.encodeStateAsUpdate(a))
    expect(late.getText('content').toString()).toBe('ac')
  })

  it('treats duplicate updates as no-ops', () => {
    const { a, textA } = peers()
    const updates: Uint8Array[] = []
    a.on('update', (u: Uint8Array) => updates.push(u))
    edit(a, () => textA.insert(0, 'x'))
    const copy = new Y.Doc()
    updates.forEach((u) => Y.applyUpdate(copy, u))
    updates.forEach((u) => Y.applyUpdate(copy, u))
    expect(copy.getText('content').toString()).toBe('x')
  })
})

describe('Y.UndoManager', () => {
  it('undoes only local edits, never a collaborator’s', () => {
    const { a, b, textA, textB } = peers()
    const undo = new Y.UndoManager(textA, { trackedOrigins: new Set([LOCAL]) })
    edit(a, () => textA.insert(0, 'mine '))
    edit(b, () => textB.insert(textB.length, 'theirs'))
    expect(textA.toString()).toBe('mine theirs')
    undo.undo()
    expect(textA.toString()).toBe('theirs')
    expect(textB.toString()).toBe('theirs')
    undo.redo()
    expect(textB.toString()).toBe('mine theirs')
  })

  it('does not undo text loaded from disk or persistence', () => {
    const doc = new Y.Doc()
    const text = doc.getText('content')
    const undo = new Y.UndoManager(text, { trackedOrigins: new Set([LOCAL]) })
    doc.transact(() => text.insert(0, 'from disk'), Symbol('disk'))
    expect(undo.undoStack).toHaveLength(0)
    edit(doc, () => text.insert(text.length, '!'))
    undo.undo()
    expect(text.toString()).toBe('from disk')
  })
})
