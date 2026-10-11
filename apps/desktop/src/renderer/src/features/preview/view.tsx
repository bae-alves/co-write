import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { usePreview } from './model'

/** Links in the preview never navigate the app window. */
function swallowLinkClicks(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a')) event.preventDefault()
}

/** The rendered column. The tree is already sanitized; it is turned into React elements, never into innerHTML. */
export function PreviewView() {
  const state = usePreview((s) => s.state)
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

  if (state.tag === 'empty') {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Nothing to preview.
      </div>
    )
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
