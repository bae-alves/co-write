import { beforeEach, describe, expect, it } from 'vitest'
import { blockLines, renderMarkdown } from '@/kit/markdown'
import { renderRtf } from '@/kit/rtf'
import { createPreviewIntents } from './intent'
import { usePreview } from './model'

function setup() {
  const pending: (() => void)[] = []
  const intents = createPreviewIntents({
    model: usePreview,
    renderers: { markdown: renderMarkdown, rtf: renderRtf },
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

  it('renders RTF through its own renderer', () => {
    const { intents, state } = setup()
    intents.show({ kind: 'rtf', text: '{\\rtf1 hi\\par}' })
    expect(state()).toMatchObject({ tag: 'rendered', kind: 'rtf' })
    intents.show({ kind: 'markdown', text: '# hi' })
    expect(state()).toMatchObject({ tag: 'rendered', kind: 'markdown' })
  })

  it('shows another document from the top and drops a pending render of the old one', () => {
    const { intents, pending, state } = setup()
    intents.show({ kind: 'markdown', text: 'a' })
    intents.followSource(30)
    intents.textChanged('a\n\nb')
    expect(pending).toHaveLength(1)
    intents.show({ kind: 'markdown', text: 'other' })
    expect(pending).toHaveLength(0)
    expect(state()).toMatchObject({ tag: 'rendered', anchorLine: 1 })
  })

  it('shows a PDF and zooms it within limits', () => {
    const { intents, state } = setup()
    const data = new Uint8Array([1, 2, 3])
    intents.show({ kind: 'pdf', data })
    expect(state()).toEqual({ tag: 'pdf', data, zoom: 1 })
    intents.zoomPdf(1.25)
    expect(state()).toMatchObject({ zoom: 1.25 })
    for (let i = 0; i < 20; i++) intents.zoomPdf(2)
    expect(state()).toMatchObject({ zoom: 3 })
    intents.zoomPdf(null)
    expect(state()).toMatchObject({ zoom: 1 })
    intents.show({ kind: 'markdown', text: 'x' })
    expect(state().tag).toBe('rendered')
  })
})
