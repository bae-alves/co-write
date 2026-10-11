import type { Element, Root } from 'hast'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

/** Every top-level block carries the source line it starts on, for source → preview scrolling. */
function rehypeSourceLines() {
  return (tree: Root) => {
    for (const node of tree.children) {
      if (node.type === 'element' && node.position) {
        node.properties = { ...node.properties, dataLine: node.position.start.line }
      }
    }
  }
}

/**
 * GitHub's sanitization rules (the rehype-sanitize default) plus our own `data-line`.
 * Scripts, event handlers, `javascript:` URLs, iframes, styles and raw HTML never survive.
 */
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataLine'],
  },
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype) // raw HTML in the Markdown is dropped, not passed through
  .use(rehypeSanitize, schema)
  .use(rehypeSourceLines)

/** Markdown source → sanitized HTML syntax tree. Pure; safe to run on untrusted input. */
export function renderMarkdown(markdown: string): Root {
  return processor.runSync(processor.parse(markdown)) as Root
}

/** The source lines of the rendered top-level blocks, in order. */
export function blockLines(tree: Root): number[] {
  return tree.children
    .filter((node): node is Element => node.type === 'element')
    .map((node) => Number(node.properties['dataLine']))
    .filter((line) => Number.isFinite(line))
}
