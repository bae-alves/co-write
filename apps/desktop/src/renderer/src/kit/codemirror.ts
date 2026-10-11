import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/** WolfRose Dark, from the VS Code theme's `colors`. */
const palette = {
  background: '#1D0F14',
  surface: '#26171C',
  raised: '#35262B',
  foreground: '#F6DCE2',
  subtle: '#A78992',
  muted: '#695B5F',
  pink: '#FFB0CB',
  red: '#F1A59C',
  green: '#A8E6B0',
  yellow: '#E7AF55',
  blue: '#5EA9C8',
  cyan: '#85C3CE',
  purple: '#C4A7E7',
}

const wolfRoseTheme = EditorView.theme(
  {
    '&': {
      color: palette.foreground,
      backgroundColor: palette.background,
      height: '100%',
      fontSize: '14px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.65',
    },
    '.cm-content': { caretColor: palette.pink, padding: '16px 0 40vh' },
    '.cm-line': { padding: '0 24px 0 12px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: palette.pink, borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: '#FFB0CB33' },
    '.cm-selectionMatch': { backgroundColor: '#FFB0CB22' },
    '.cm-searchMatch': { backgroundColor: '#E7AF5533' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#E7AF5555' },
    '.cm-activeLine': { backgroundColor: `${palette.raised}88` },
    '.cm-gutters': {
      backgroundColor: palette.background,
      color: palette.muted,
      border: 'none',
      paddingLeft: '8px',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: palette.subtle },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '3ch' },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: palette.raised,
      outline: `1px solid ${palette.subtle}`,
    },
    '.cm-panels': { backgroundColor: palette.surface, color: palette.foreground, border: 'none' },
    '.cm-panels.cm-panels-top': { borderBottom: 'none' },
    '.cm-panels.cm-panels-bottom': { borderTop: 'none' },
    '.cm-panel.cm-search': { padding: '6px 10px' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': {
      backgroundColor: palette.raised,
      color: palette.foreground,
      border: 'none',
      borderRadius: '4px',
      backgroundImage: 'none',
    },
    '.cm-panel.cm-search input:focus': { outline: `1px solid ${palette.pink}` },
    '.cm-panel.cm-search label': { color: palette.subtle },
    '.cm-tooltip': { backgroundColor: palette.raised, color: palette.foreground, border: 'none' },
    '.cm-ySelectionInfo': {
      fontFamily: 'var(--font-sans, system-ui)',
      fontWeight: '600',
      color: palette.background,
      padding: '1px 4px',
      borderRadius: '3px 3px 3px 0',
      opacity: '1',
    },
  },
  { dark: true },
)

/** WolfRose `tokenColors`, mapped onto Lezer's tags (Markdown first, then embedded code). */
const wolfRoseHighlight = HighlightStyle.define([
  // Markdown
  { tag: t.heading, color: palette.pink, fontWeight: '700' },
  { tag: t.heading1, color: palette.pink, fontWeight: '700', fontSize: '1.2em' },
  { tag: t.heading2, color: palette.pink, fontWeight: '700', fontSize: '1.1em' },
  { tag: t.strong, color: palette.pink, fontWeight: '700' },
  { tag: t.emphasis, color: palette.purple, fontStyle: 'italic' },
  { tag: t.strikethrough, color: palette.red, textDecoration: 'line-through' },
  { tag: t.link, color: palette.blue },
  { tag: t.url, color: palette.cyan, textDecoration: 'underline' },
  { tag: t.monospace, color: palette.yellow },
  { tag: t.quote, color: palette.subtle, fontStyle: 'italic' },
  { tag: t.list, color: palette.red },
  { tag: t.contentSeparator, color: palette.muted },
  { tag: [t.processingInstruction, t.labelName], color: palette.subtle },
  // Code (fenced blocks highlighted through @codemirror/language-data)
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: palette.muted,
    fontStyle: 'italic',
  },
  { tag: [t.punctuation, t.bracket, t.separator, t.meta], color: palette.subtle },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: palette.yellow },
  { tag: [t.attributeName], color: palette.yellow },
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.modifier,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
    ],
    color: palette.red,
  },
  { tag: [t.macroName, t.tagName, t.angleBracket], color: palette.red },
  { tag: t.deleted, color: palette.red },
  { tag: t.inserted, color: palette.green },
  { tag: t.invalid, color: palette.red, textDecoration: 'underline' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: palette.pink },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.definition(t.function(t.variableName)),
    ],
    color: palette.blue,
  },
  {
    tag: [t.variableName, t.propertyName, t.self, t.definition(t.variableName)],
    color: palette.cyan,
  },
  {
    tag: [t.number, t.bool, t.atom, t.null, t.constant(t.variableName), t.annotation],
    color: palette.purple,
  },
])

/** Everything the Markdown editor needs except the Yjs binding (added per document). */
export function markdownEditorExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(wolfRoseHighlight),
    wolfRoseTheme,
    keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
  ]
}
