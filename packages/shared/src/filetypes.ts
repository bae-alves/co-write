/**
 * Which files co-write opens, and how. Shared by main (what may be listed, read, written and
 * created) and the renderer (which columns a file gets). Pure: no I/O, no dependencies.
 *
 * Every simple text format opens in the source column. A preview exists only where one makes
 * sense: Markdown and RTF render; PDF is shown in the preview column alone (it has no source);
 * everything else (JSON, YAML, TOML, XML, plain text, code, …) is source only.
 */

export type PreviewKind = 'markdown' | 'rtf' | 'pdf' | 'none'

export interface FileKind {
  /** What the preview column shows for this file. */
  readonly preview: PreviewKind
  /** Not text: read as bytes, never edited or written (PDF). Such files have no source column. */
  readonly binary: boolean
}

const MARKDOWN: FileKind = { preview: 'markdown', binary: false }
const RTF: FileKind = { preview: 'rtf', binary: false }
const PDF: FileKind = { preview: 'pdf', binary: true }
const TEXT: FileKind = { preview: 'none', binary: false }

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd']

const TEXT_EXTENSIONS = [
  // Plain text and logs
  'txt',
  'text',
  'log',
  'nfo',
  // Data and configuration
  'json',
  'jsonc',
  'json5',
  'jsonl',
  'ndjson',
  'geojson',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'config',
  'properties',
  'env',
  'editorconfig',
  'csv',
  'tsv',
  // XML and friends
  'xml',
  'xsd',
  'xsl',
  'xslt',
  'dtd',
  'svg',
  'plist',
  'rss',
  'atom',
  'opml',
  'kml',
  'gpx',
  'xhtml',
  // Web
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  // Code
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'mts',
  'cts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'scala',
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'cs',
  'swift',
  'php',
  'pl',
  'lua',
  'r',
  'dart',
  'sql',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'gradle',
  'cmake',
  'tf',
  'proto',
  // Writing
  'tex',
  'bib',
  'sty',
  'cls',
  'rst',
  'adoc',
  'asciidoc',
  'org',
  'srt',
  'vtt',
  'diff',
  'patch',
]

/** Extension-less files that are plain text, matched on the lower-cased base name. */
const TEXT_NAMES = [
  'dockerfile',
  'makefile',
  'gnumakefile',
  'license',
  'licence',
  'copying',
  'readme',
  'authors',
  'changelog',
  'notice',
  'procfile',
  'gemfile',
  'rakefile',
  'vagrantfile',
  'jenkinsfile',
]

const BY_EXTENSION: ReadonlyMap<string, FileKind> = new Map([
  ...MARKDOWN_EXTENSIONS.map((ext): [string, FileKind] => [ext, MARKDOWN]),
  ...TEXT_EXTENSIONS.map((ext): [string, FileKind] => [ext, TEXT]),
  ['rtf', RTF],
  ['pdf', PDF],
])

const NAMES: ReadonlySet<string> = new Set(TEXT_NAMES)

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** The kind of file `path` names, or null when co-write does not open it. */
export function fileKindOf(path: string): FileKind | null {
  const name = baseName(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  // `a.json`, and also `.env`, whose whole name is its extension.
  const byExtension = dot >= 0 ? BY_EXTENSION.get(name.slice(dot + 1)) : undefined
  if (byExtension) return byExtension
  return dot < 0 && NAMES.has(name) ? TEXT : null
}

/** True for files co-write lists and opens. */
export const isSupportedFile = (path: string): boolean => fileKindOf(path) !== null

/** Text files can be read, edited, saved and created; binary ones (PDF) can only be shown. */
export const isTextFile = (path: string): boolean => fileKindOf(path)?.binary === false

export const isPdfFile = (path: string): boolean => fileKindOf(path)?.preview === 'pdf'

export const isMarkdownFile = (path: string): boolean => fileKindOf(path) === MARKDOWN

/** Which of the two middle columns a file uses. */
export interface Capabilities {
  readonly source: boolean
  readonly preview: boolean
}

const SOURCE_AND_PREVIEW: Capabilities = Object.freeze({ source: true, preview: true })
const SOURCE_ONLY: Capabilities = Object.freeze({ source: true, preview: false })
const PREVIEW_ONLY: Capabilities = Object.freeze({ source: false, preview: true })
const NEITHER: Capabilities = Object.freeze({ source: false, preview: false })

/** Always one of four shared objects, so it is safe to return from a store selector. */
export function capabilitiesOf(kind: FileKind): Capabilities {
  const source = !kind.binary
  const preview = kind.preview !== 'none'
  if (source && preview) return SOURCE_AND_PREVIEW
  if (source) return SOURCE_ONLY
  return preview ? PREVIEW_ONLY : NEITHER
}

/** What an unknown or shared document is treated as: Markdown, like every shared document so far. */
export const DEFAULT_KIND: FileKind = MARKDOWN
