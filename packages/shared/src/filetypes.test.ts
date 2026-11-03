import { describe, expect, it } from 'vitest'
import {
  capabilitiesOf,
  fileKindOf,
  isMarkdownFile,
  isPdfFile,
  isSupportedFile,
  isTextFile,
} from './filetypes'

describe('fileKindOf', () => {
  it('previews Markdown and RTF', () => {
    expect(fileKindOf('notes/a.md')?.preview).toBe('markdown')
    expect(fileKindOf('A.MARKDOWN')?.preview).toBe('markdown')
    expect(fileKindOf('letter.rtf')?.preview).toBe('rtf')
  })

  it('opens simple text formats without a preview', () => {
    for (const name of [
      'a.txt',
      'a.json',
      'a.yaml',
      'a.yml',
      'a.toml',
      'a.xml',
      'a.svg',
      'a.csv',
      'a.ini',
      'a.log',
      'main.ts',
      '.env',
      'Dockerfile',
      'LICENSE',
      'deep/Makefile',
    ]) {
      expect(fileKindOf(name), name).toEqual({ preview: 'none', binary: false })
    }
  })

  it('treats PDF as binary with a preview only', () => {
    expect(fileKindOf('paper.pdf')).toEqual({ preview: 'pdf', binary: true })
    expect(isPdfFile('paper.PDF')).toBe(true)
    expect(isTextFile('paper.pdf')).toBe(false)
    expect(isSupportedFile('paper.pdf')).toBe(true)
  })

  it('ignores what it cannot show', () => {
    for (const name of ['a.png', 'a.zip', 'a.exe', 'a', 'noext/file', 'dockerfile.bak']) {
      expect(fileKindOf(name), name).toBeNull()
    }
    expect(isSupportedFile('a.png')).toBe(false)
    expect(isTextFile('a.png')).toBe(false)
  })

  it('only says Markdown for Markdown', () => {
    expect(isMarkdownFile('a.md')).toBe(true)
    expect(isMarkdownFile('a.txt')).toBe(false)
    expect(isMarkdownFile('a.rtf')).toBe(false)
  })
})

describe('capabilitiesOf', () => {
  it('gives each kind its columns', () => {
    const caps = (path: string) => capabilitiesOf(fileKindOf(path)!)
    expect(caps('a.md')).toEqual({ source: true, preview: true })
    expect(caps('a.rtf')).toEqual({ source: true, preview: true })
    expect(caps('a.json')).toEqual({ source: true, preview: false })
    expect(caps('a.pdf')).toEqual({ source: false, preview: true })
  })
})
