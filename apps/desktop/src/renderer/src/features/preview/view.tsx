import { Minus, Plus } from 'lucide-react'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { lazy, Suspense, useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { IconButton } from '@/components/ui/section'
import { useDocument } from '@/features/document/model'
import { previewIntents } from './intent'
import { usePreview } from './model'

// pdf.js is large; it loads the first time a PDF is shown.
const PdfPages = lazy(() => import('./pdf-pages'))

/** Links in the preview never navigate the app window. */
function swallowLinkClicks(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a')) event.preventDefault()
}

function Message({ children, error = false }: { children: string; error?: boolean }) {
  return (
    <div
      className={`flex flex-1 items-center justify-center p-6 text-center text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {children}
    </div>
  )
}

/** The rendered column. The tree is already sanitized; it is turned into React elements, never into innerHTML. */
export function PreviewView() {
  const state = usePreview((s) => s.state)
  const document = useDocument((s) => s.state)
  const scroller = useRef<HTMLDivElement>(null)

  const content = useMemo(
    () => (state.tag === 'rendered' ? toJsxRuntime(state.tree, { Fragment, jsx, jsxs }) : null),
    [state],
  )

  const anchorLine = state.tag === 'rendered' ? state.anchorLine : 1
  useEffect(() => {
    const container = scroller.current
    if (!container) return
    if (anchorLine <= 1) {
      container.scrollTo({ top: 0 })
      return
    }
    const blocks = [...container.querySelectorAll<HTMLElement>('[data-line]')]
    const target = blocks.filter((el) => Number(el.dataset['line']) <= anchorLine).pop()
    if (target) container.scrollTo({ top: target.offsetTop - 16 })
  }, [anchorLine, content])

  if (state.tag === 'pdf') {
    return (
      <>
        <div className="flex h-8 shrink-0 items-center justify-end gap-0.5 bg-surface px-2 text-xs text-subtle-foreground">
          <IconButton label="Zoom out" onClick={() => previewIntents.zoomPdf(1 / 1.25)}>
            <Minus />
          </IconButton>
          <button
            type="button"
            title="Fit to width"
            className="w-12 rounded-md py-1 text-center tabular-nums hover:bg-raised"
            onClick={() => previewIntents.zoomPdf(null)}
          >
            {Math.round(state.zoom * 100)}%
          </button>
          <IconButton label="Zoom in" onClick={() => previewIntents.zoomPdf(1.25)}>
            <Plus />
          </IconButton>
        </div>
        <Suspense fallback={<Message>Opening PDF…</Message>}>
          <PdfPages data={state.data} zoom={state.zoom} />
        </Suspense>
      </>
    )
  }

  if (state.tag === 'empty') {
    // A file with no source column (PDF) has nowhere else to say why it did not open.
    if (document.tag === 'failed' || document.tag === 'closed') {
      return <Message error>{document.reason}</Message>
    }
    if (document.tag === 'loading') return <Message>{`Opening ${document.title}…`}</Message>
    return <Message>Nothing to preview.</Message>
  }

  return (
    <div
      ref={scroller}
      className="relative min-h-0 flex-1 overflow-y-auto"
      onClick={swallowLinkClicks}
      aria-label="Preview"
      role="document"
    >
      <article className="prose-wolfrose">{content}</article>
    </div>
  )
}
