import { renderMarkdown } from '@/kit/markdown'
import { usePreview } from './model'

export interface PreviewDeps {
  readonly model: typeof usePreview
  readonly render: typeof renderMarkdown
  /** Runs `task` after `ms`; returns a cancel function. */
  readonly schedule: (task: () => void, ms: number) => () => void
}

const RENDER_DELAY_MS = 120

export function createPreviewIntents({ model, render, schedule }: PreviewDeps) {
  let cancelPending: (() => void) | null = null
  let latest = ''

  const renderNow = () => {
    cancelPending = null
    const state = model.getState().state
    const anchorLine = state.tag === 'rendered' ? state.anchorLine : 1
    model.getState().go({ tag: 'rendered', tree: render(latest), anchorLine })
  }

  return {
    /** The document text changed. Renders right away the first time, then at most every 120 ms. */
    textChanged(text: string): void {
      latest = text
      if (model.getState().state.tag === 'empty') return renderNow()
      cancelPending ??= schedule(renderNow, RENDER_DELAY_MS)
    },

    /** The editor scrolled; keep the matching part of the preview in view. */
    followSource(line: number): void {
      const state = model.getState().state
      if (state.tag !== 'rendered' || state.anchorLine === line) return
      model.getState().go({ ...state, anchorLine: line })
    },

    clear(): void {
      cancelPending?.()
      cancelPending = null
      latest = ''
      model.getState().go({ tag: 'empty' })
    },
  }
}

export const previewIntents = createPreviewIntents({
  model: usePreview,
  render: renderMarkdown,
  schedule: (task, ms) => {
    const timer = setTimeout(task, ms)
    return () => clearTimeout(timer)
  },
})
