import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useEffect, useRef, useState } from 'react'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const PAGE_GAP_PX = 12
const GUTTER_PX = 24

/** One page, drawn onto a canvas when it nears the viewport and redrawn when the width changes. */
function Page({ doc, number, width }: { doc: PDFDocumentProxy; number: number; width: number }) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [ratio, setRatio] = useState(Math.SQRT2)

  useEffect(() => {
    const element = holder.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && setNear(true),
      { rootMargin: '800px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!near || width <= 0) return
    let cancelled = false
    let task: RenderTask | null = null
    void doc.getPage(number).then(async (page) => {
      const base = page.getViewport({ scale: 1 })
      if (cancelled || !canvas.current) return
      setRatio(base.height / base.width)
      const viewport = page.getViewport({ scale: (width / base.width) * window.devicePixelRatio })
      const target = canvas.current
      target.width = Math.floor(viewport.width)
      target.height = Math.floor(viewport.height)
      const context = target.getContext('2d')
      if (!context) return
      task = page.render({ canvas: target, canvasContext: context, viewport })
      await task.promise.catch(() => {
        // A cancelled render (width changed, page closed) is expected.
      })
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [near, width, doc, number])

  return (
    <div
      ref={holder}
      className="mx-auto bg-white shadow-md"
      style={{ width, height: width * ratio, marginBottom: PAGE_GAP_PX }}
      role="img"
      aria-label={`Page ${number}`}
    >
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

/** All pages of a PDF, scrolling in the column. `zoom` 1 fits the column's width. */
export default function PdfPages({ data, zoom }: { data: Uint8Array; zoom: number }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<{ data: Uint8Array; doc: PDFDocumentProxy } | null>(null)
  const [failure, setFailure] = useState<{ data: Uint8Array; message: string } | null>(null)
  const [columnWidth, setColumnWidth] = useState(0)

  useEffect(() => {
    // pdf.js takes ownership of the buffer it is given; hand it a copy.
    const task = pdfjs.getDocument({ data: data.slice(), isEvalSupported: false })
    let cancelled = false
    task.promise.then(
      (doc) => !cancelled && setLoaded({ data, doc }),
      (error: unknown) =>
        !cancelled &&
        setFailure({ data, message: error instanceof Error ? error.message : String(error) }),
    )
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [data])

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const observer = new ResizeObserver(() => setColumnWidth(element.clientWidth))
    observer.observe(element)
    setColumnWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const doc = loaded?.data === data ? loaded.doc : null
  const failed = failure?.data === data ? failure.message : null
  const pageWidth = Math.max(0, (columnWidth - GUTTER_PX) * zoom)

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-background p-3" aria-label="PDF">
      {failed ? (
        <p role="alert" className="p-3 text-sm text-destructive">
          Could not read this PDF: {failed}
        </p>
      ) : !doc ? (
        <p className="p-3 text-sm text-muted-foreground">Opening PDF…</p>
      ) : (
        Array.from({ length: doc.numPages }, (_, index) => (
          <Page key={index} doc={doc} number={index + 1} width={pageWidth} />
        ))
      )}
    </div>
  )
}
