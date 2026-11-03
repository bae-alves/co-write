import { toHtml } from 'hast-util-to-html'
import { describe, expect, it } from 'vitest'
import { renderRtf } from './rtf'

const html = (rtf: string) => toHtml(renderRtf(rtf))

describe('renderRtf', () => {
  it('renders paragraphs and the usual character formatting', () => {
    expect(html('{\\rtf1\\ansi Hello \\b bold\\b0  and \\i italic\\i0 .\\par Second}')).toBe(
      '<p>Hello <strong>bold</strong> and <em>italic</em>.</p><p>Second</p>',
    )
    expect(html('{\\rtf1 \\ul under\\ulnone  \\strike gone\\strike0 \\par}')).toBe(
      '<p><u>under</u> <s>gone</s></p>',
    )
  })

  it('scopes formatting to its group', () => {
    expect(html('{\\rtf1 a {\\b b} c\\par}')).toBe('<p>a <strong>b</strong> c</p>')
  })

  it('keeps blank lines, line breaks and alignment', () => {
    expect(html('{\\rtf1 a\\par\\par b\\line c\\par}')).toBe('<p>a</p><p><br></p><p>b<br>c</p>')
    expect(html('{\\rtf1 \\pard\\qc centered\\par\\pard plain\\par}')).toBe(
      '<p style="text-align:center">centered</p><p>plain</p>',
    )
  })

  it('decodes escapes: hex bytes, unicode with its fallback, symbols', () => {
    // \u-10179\u-8704 is the surrogate pair of U+1F600; the `?` after each is the fallback.
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1252 caf\\'e9 \\u8364? \\u-10179?\\u-8704? \\emdash  \\{x\\}\\par}"
    expect(html(rtf)).toBe('<p>café € \u{1F600} \u2014 {x}</p>')
  })

  it('skips font tables, colours, pictures, headers and ignorable destinations', () => {
    const rtf =
      '{\\rtf1{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red255;}{\\*\\generator Word}{\\info{\\title t}}' +
      '{\\pict\\wmetafile8 0123abcd}{\\header hidden}Visible\\par}'
    expect(html(rtf)).toBe('<p>Visible</p>')
  })

  it('shows the result of a field, not its instruction', () => {
    expect(
      html('{\\rtf1 See {\\field{\\*\\fldinst{HYPERLINK "http://x"}}{\\fldrslt the site}}\\par}'),
    ).toBe('<p>See the site</p>')
  })

  it('ignores raw line breaks and survives garbage', () => {
    expect(html('{\\rtf1 one\r\ntwo\\par}')).toBe('<p>onetwo</p>')
    expect(renderRtf('').children).toEqual([])
    expect(() => renderRtf("{\\rtf1 {{{ \\b \\u \\' \\bin5 ab}")).not.toThrow()
  })

  it('never emits anything but text, formatting and breaks', () => {
    const out = html('{\\rtf1 <script>alert(1)</script> <b onclick=x>y</b>\\par}')
    expect(out).toBe('<p>&#x3C;script>alert(1)&#x3C;/script> &#x3C;b onclick=x>y&#x3C;/b></p>')
  })
})
