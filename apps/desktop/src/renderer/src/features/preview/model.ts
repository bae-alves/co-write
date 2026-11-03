import type { Root } from 'hast'
import { createDfaModel } from '@/kit/dfa'

export type RenderedKind = 'markdown' | 'rtf'

export type Preview =
  | { readonly tag: 'empty' }
  | {
      readonly tag: 'rendered'
      readonly kind: RenderedKind
      /** Sanitized HTML syntax tree of the current document. */
      readonly tree: Root
      /** The source line at the top of the editor; the preview keeps it in view. */
      readonly anchorLine: number
    }
  | {
      readonly tag: 'pdf'
      /** The file's bytes; the viewer copies them, since pdf.js takes ownership of what it gets. */
      readonly data: Uint8Array
      /** 1 fits the column's width. */
      readonly zoom: number
    }

/**
 *   empty ◄──► rendered ⟲   (new text, new anchor)
 *     ▲            ▲
 *     └────► pdf ◄─┘   ⟲   (zoom)
 */
export const usePreview = createDfaModel<Preview>(
  { tag: 'empty' },
  {
    empty: ['rendered', 'pdf', 'empty'],
    rendered: ['rendered', 'pdf', 'empty'],
    pdf: ['pdf', 'rendered', 'empty'],
  },
)
