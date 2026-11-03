import type { Root } from 'hast'
import { renderMarkdown } from '@/kit/markdown'
import { renderRtf } from '@/kit/rtf'
import { usePreview, type RenderedKind } from './model'

/** What the preview column should show. Kinds without a preview never reach it (`clear`). */
export type PreviewSource =
  | { readonly kind: RenderedKind; readonly text: string }
  | { readonly kind: 'pdf'; readonly data: Uint8Array }

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 3

export interface PreviewDeps {
  readonly model: typeof usePreview
  readonly renderers: Record<RenderedKind, (text: string) => Root>
  /** Runs `task` after `ms`; returns a cancel function. */
  readonly schedule: (task: () => void, ms: number) => () => void
}

const RENDER_DELAY_MS = 120

export function createPreviewIntents({ model, renderers, schedule }: PreviewDeps) {
  let cancelPending: (() => void) | null = null
  let latest = ''
  let kind: RenderedKind = 'markdown'

  const cancel = () => {
    cancelPending?.()
    cancelPending = null
  }

  const renderNow = (anchorLine?: number) => {
    cancelPending = null
    const state = model.getState().state
    model.getState().go({
      tag: 'rendered',
      kind,
      tree: renderers[kind](latest),
      anchorLine: anchorLine ?? (state.tag === 'rendered' ? state.anchorLine : 1),
    })
  }

  return {
    /** Another document is showing: render it right away, from the top. */
    show(source: PreviewSource): void {
      cancel()
      if (source.kind === 'pdf') {
        const state = model.getState().state
        model.getState().go({
          tag: 'pdf',
          data: source.data,
          zoom: state.tag === 'pdf' ? state.zoom : 1,
        })
        return
      }
      kind = source.kind
      latest = source.text
      renderNow(1)
    },

    /** The document text changed. Renders right away the first time, then at most every 120 ms. */
    textChanged(text: string): void {
      latest = text
      if (model.getState().state.tag !== 'rendered') return renderNow()
      cancelPending ??= schedule(() => renderNow(), RENDER_DELAY_MS)
    },

    /** The editor scrolled; keep the matching part of the preview in view. */
    followSource(line: number): void {
      const state = model.getState().state
      if (state.tag !== 'rendered' || state.anchorLine === line) return
      model.getState().go({ ...state, anchorLine: line })
    },

    /** Zoom the PDF by `factor` (1.25 zooms in), or back to fit with `null`. */
    zoomPdf(factor: number | null): void {
      const state = model.getState().state
      if (state.tag !== 'pdf') return
      const zoom = factor === null ? 1 : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor))
      if (zoom !== state.zoom) model.getState().go({ ...state, zoom })
    },

    clear(): void {
      cancel()
      latest = ''
      if (model.getState().state.tag !== 'empty') model.getState().go({ tag: 'empty' })
    },
  }
}

export const previewIntents = createPreviewIntents({
  model: usePreview,
  renderers: { markdown: renderMarkdown, rtf: renderRtf },
  schedule: (task, ms) => {
    const timer = setTimeout(task, ms)
    return () => clearTimeout(timer)
  },
})
