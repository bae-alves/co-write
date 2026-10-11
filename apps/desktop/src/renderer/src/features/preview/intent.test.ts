import { beforeEach, describe, expect, it } from 'vitest'
import { blockLines, renderMarkdown } from '@/kit/markdown'
import { createPreviewIntents } from './intent'
import { usePreview } from './model'

function setup() {
  const pending: (() => void)[] = []
  const intents = createPreviewIntents({
    model: usePreview,
    render: renderMarkdown,
    schedule: (task) => {
      pending.push(task)
      return () => pending.splice(pending.indexOf(task), 1)
    },
  })
  const flush = () => pending.splice(0).forEach((task) => task())
  return { intents, flush, pending, state: () => usePreview.getState().state }
}

beforeEach(() => {
  usePreview.setState(usePreview.getInitialState(), true)
})

describe('preview intents', () => {
  it('renders the first text immediately', () => {
    const { intents, state } = setup()
    intents.textChanged('# hello')
    const current = state()
    expect(current.tag).toBe('rendered')
    if (current.tag === 'rendered') expect(blockLines(current.tree)).toEqual([1])
  })

  it('coalesces bursts of edits into one render of the latest text', () => {
    const { intents, flush, pending, state } = setup()
    intents.textChanged('a')
    intents.textChanged('a\n\nb')
    intents.textChanged('a\n\nb\n\nc')
    expect(pending).toHaveLength(1)
    flush()
    const current = state()
    if (current.tag !== 'rendered') throw new Error('expected rendered')
    expect(blockLines(current.tree)).toEqual([1, 3, 5])
  })

  it('follows the editor scroll position and keeps it across renders', () => {
    const { intents, flush, state } = setup()
    intents.textChanged('a')
    intents.followSource(12)
    intents.textChanged('b')
    flush()
    expect(state()).toMatchObject({ tag: 'rendered', anchorLine: 12 })
  })

  it('clears and drops a pending render', () => {
    const { intents, pending, state } = setup()
    intents.textChanged('a')
    intents.textChanged('b')
    intents.clear()
    expect(pending).toHaveLength(0)
    expect(state()).toEqual({ tag: 'empty' })
  })
})
