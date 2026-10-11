import { toHtml } from 'hast-util-to-html'
import { describe, expect, it } from 'vitest'
import { blockLines, renderMarkdown } from './markdown'

const html = (markdown: string) => toHtml(renderMarkdown(markdown))

describe('renderMarkdown', () => {
  it('renders CommonMark and GFM', () => {
    const out = html(
      '# Title\n\n**bold** ~~gone~~\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n',
    )
    expect(out).toContain('<h1 data-line="1">Title</h1>')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<del>gone</del>')
    expect(out).toContain('<table')
    expect(out).toContain('type="checkbox"')
  })

  it('drops raw HTML, scripts and event handlers', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<b>raw</b>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<b>')
  })

  it('neutralizes javascript: links', () => {
    const out = html('[click](javascript:alert(1)) [ok](https://example.com)')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('href="https://example.com"')
  })

  it('records the source line of each top-level block', () => {
    expect(blockLines(renderMarkdown('# a\n\npara\n\n\n- item\n'))).toEqual([1, 3, 6])
  })
})
