import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppAsset } from './protocol'

const dir = '/opt/co-write/resources/app/out/renderer'

describe('resolveAppAsset', () => {
  it('serves bundled files', () => {
    expect(resolveAppAsset(dir, 'app://co-write/index.html')).toBe(join(dir, 'index.html'))
    expect(resolveAppAsset(dir, 'app://co-write/')).toBe(join(dir, 'index.html'))
    expect(resolveAppAsset(dir, 'app://co-write/assets/index-abc.js?x=1')).toBe(
      join(dir, 'assets', 'index-abc.js'),
    )
  })

  it('keeps dot segments inside the renderer folder', () => {
    // The URL parser collapses (encoded) dot segments before we see the path.
    expect(resolveAppAsset(dir, 'app://co-write/%2e%2e/%2e%2e/main/index.js')).toBe(
      join(dir, 'main', 'index.js'),
    )
  })

  it.each([
    ['another host', 'app://evil/index.html'],
    ['another scheme', 'file:///etc/passwd'],
    ['encoded separator traversal', 'app://co-write/..%2f..%2fmain%2findex.js'],
    ['NUL', 'app://co-write/index.html%00.png'],
    ['garbage', 'not a url'],
    ['bad escapes', 'app://co-write/%E0%A4%A'],
  ])('refuses %s', (_name, url) => {
    expect(resolveAppAsset(dir, url)).toBeNull()
  })
})
