import type { Root } from 'hast'
import { createDfaModel } from '@/kit/dfa'

export type Preview =
  | { readonly tag: 'empty' }
  | {
      readonly tag: 'rendered'
      /** Sanitized HTML syntax tree of the current document. */
      readonly tree: Root
      /** The source line at the top of the editor; the preview keeps it in view. */
      readonly anchorLine: number
    }

/**
 *   empty ◄──► rendered ─┐
 *                 ▲      │ (new text, new anchor)
 *                 └──────┘
 */
export const usePreview = createDfaModel<Preview>(
  { tag: 'empty' },
  { empty: ['rendered', 'empty'], rendered: ['rendered', 'empty'] },
)
