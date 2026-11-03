import type { Element, ElementContent, Root } from 'hast'

/**
 * RTF → HTML syntax tree, for the preview. Handles what plain documents use: paragraphs, line
 * breaks, tabs, bold / italic / underline / strike, alignment, `\'hh` and `\uN` escapes and the
 * usual punctuation words. Pictures, fonts, colours, headers, footers, lists' bullet text and
 * everything behind `\*` are skipped. The tree is built here from a fixed set of elements, so no
 * input can produce a script, a link or an attribute we did not choose.
 */

interface Style {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  /** Inside a destination we do not render (font table, picture, …). */
  skip: boolean
  /** Characters to drop after `\uN` (`\ucN`). */
  uc: number
}

/** Destinations whose content is not document text. */
const SKIPPED = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'fldinst',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'xmlnstbl',
  'objdata',
  'bkmkstart',
  'bkmkend',
  'template',
  'revtbl',
  'userprops',
  'generator',
])

/** Control words that stand for one character. */
const SYMBOLS: Record<string, string> = {
  emdash: '—',
  endash: '–',
  emspace: ' ',
  enspace: ' ',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  tab: '    ',
  cell: '    ',
}

const ALIGN: Record<string, string> = {
  ql: 'left',
  qr: 'right',
  qc: 'center',
  qj: 'justify',
}

const el = (tagName: string, children: ElementContent[], style?: string): Element => ({
  type: 'element',
  tagName,
  properties: style ? { style } : {},
  children,
})

function decoderFor(codepage: number): TextDecoder {
  for (const label of [`windows-${codepage}`, `cp${codepage}`, 'windows-1252']) {
    try {
      return new TextDecoder(label)
    } catch {
      // Not a label this runtime knows; try the next.
    }
  }
  return new TextDecoder()
}

export function renderRtf(source: string): Root {
  const blocks: Element[] = []
  let inline: ElementContent[] = []
  let run = ''
  let runStyle: Style | null = null
  let align: string | null = null
  let decoder = decoderFor(1252)
  /** Fallback characters still to drop after a `\uN`. */
  const pending = { skip: 0 }

  const stack: Style[] = []
  let style: Style = {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    skip: false,
    uc: 1,
  }

  const sameFormat = (a: Style, b: Style) =>
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike

  const flushRun = () => {
    if (run === '' || runStyle === null) return
    let node: ElementContent = { type: 'text', value: run }
    if (runStyle.strike) node = el('s', [node])
    if (runStyle.underline) node = el('u', [node])
    if (runStyle.italic) node = el('em', [node])
    if (runStyle.bold) node = el('strong', [node])
    inline.push(node)
    run = ''
  }

  const text = (value: string) => {
    if (style.skip || value === '') return
    if (runStyle === null || !sameFormat(runStyle, style)) {
      flushRun()
      runStyle = { ...style }
    }
    run += value
  }

  const endParagraph = () => {
    flushRun()
    runStyle = null
    blocks.push(
      el(
        'p',
        inline.length > 0 ? inline : [el('br', [])],
        align ? `text-align:${align}` : undefined,
      ),
    )
    inline = []
  }

  let i = 0
  const n = source.length
  /** The next character is the first thing in its group (a destination can follow). */
  let groupStart = false

  while (i < n) {
    const char = source[i]!

    if (char === '{') {
      stack.push({ ...style })
      groupStart = true
      i++
      continue
    }
    if (char === '}') {
      flushRun()
      style = stack.pop() ?? style
      groupStart = false
      i++
      continue
    }
    if (char === '\r' || char === '\n') {
      i++
      continue
    }
    if (char !== '\\') {
      groupStart = false
      if (pending.skip > 0) pending.skip--
      else text(char)
      i++
      continue
    }

    // A control word or symbol.
    i++
    const next = source[i]
    if (next === undefined) break

    if (next === '*') {
      // An optional destination we do not understand: drop the whole group.
      style.skip = true
      groupStart = false
      i++
      continue
    }
    if (next === "'") {
      const code = Number.parseInt(source.slice(i + 1, i + 3), 16)
      i += 3
      groupStart = false
      if (pending.skip > 0) pending.skip--
      else if (!Number.isNaN(code)) {
        text(code < 0x80 ? String.fromCharCode(code) : decoder.decode(Uint8Array.of(code)))
      }
      continue
    }
    if (!/[a-zA-Z]/.test(next)) {
      i++
      groupStart = false
      if (next === '\\' || next === '{' || next === '}') {
        if (pending.skip > 0) pending.skip--
        else text(next)
      } else if (next === '~') text(' ')
      else if (next === '_') text('‑')
      else if (next === '\n' || next === '\r') endParagraph()
      continue
    }

    let end = i
    while (end < n && /[a-zA-Z]/.test(source[end]!)) end++
    const word = source.slice(i, end)
    let numberEnd = end
    if (source[numberEnd] === '-') numberEnd++
    while (numberEnd < n && /[0-9]/.test(source[numberEnd]!)) numberEnd++
    const parameter = numberEnd > end ? Number.parseInt(source.slice(end, numberEnd), 10) : null
    i = source[numberEnd] === ' ' ? numberEnd + 1 : numberEnd

    const wasGroupStart = groupStart
    groupStart = false
    if (wasGroupStart && SKIPPED.has(word)) {
      style.skip = true
      continue
    }

    switch (word) {
      case 'par':
      case 'sect':
      case 'row':
        if (!style.skip) endParagraph()
        break
      case 'line':
        if (!style.skip) {
          flushRun()
          inline.push(el('br', []))
        }
        break
      case 'pard':
        align = null
        break
      case 'plain':
        style.bold = style.italic = style.underline = style.strike = false
        break
      case 'b':
        style.bold = parameter !== 0
        break
      case 'i':
        style.italic = parameter !== 0
        break
      case 'ul':
        style.underline = parameter !== 0
        break
      case 'ulnone':
        style.underline = false
        break
      case 'strike':
        style.strike = parameter !== 0
        break
      case 'uc':
        style.uc = Math.max(0, parameter ?? 1)
        break
      case 'u':
        if (parameter !== null) {
          if (pending.skip > 0) pending.skip--
          else text(String.fromCharCode(parameter < 0 ? parameter + 65536 : parameter))
          pending.skip = style.uc
        }
        break
      case 'ansicpg':
        if (parameter !== null) decoder = decoderFor(parameter)
        break
      case 'bin':
        // Raw binary follows; it is never document text.
        i += Math.max(0, parameter ?? 0)
        break
      default:
        if (word in ALIGN) align = ALIGN[word]!
        else if (word in SYMBOLS) text(SYMBOLS[word]!)
    }
  }

  if (run !== '' || inline.length > 0) endParagraph()
  return { type: 'root', children: blocks }
}
