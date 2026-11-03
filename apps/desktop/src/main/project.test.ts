import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { launchTarget } from './project'

let base: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'co-write-launch-')))
  await mkdir(join(base, 'notes'))
  await writeFile(join(base, 'notes', 'a.md'), '# a')
  await writeFile(join(base, 'notes', 'b.txt'), 'b')
  await writeFile(join(base, 'notes', 'c.png'), 'png')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('launchTarget', () => {
  it('opens a Markdown file inside its folder', async () => {
    expect(await launchTarget([join(base, 'notes', 'a.md')], '/')).toEqual({
      root: join(base, 'notes'),
      file: 'a.md',
    })
  })

  it('opens folders, relative paths and file:// URLs', async () => {
    expect(await launchTarget(['notes'], base)).toEqual({ root: join(base, 'notes'), file: null })
    expect(await launchTarget([pathToFileURL(join(base, 'notes', 'a.md')).href], '/')).toEqual({
      root: join(base, 'notes'),
      file: 'a.md',
    })
  })

  it('follows symlinks to the folder that really holds the file', async () => {
    await symlink(join(base, 'notes', 'a.md'), join(base, 'link.md'))
    expect(await launchTarget([join(base, 'link.md')], '/')).toEqual({
      root: join(base, 'notes'),
      file: 'a.md',
    })
  })

  it('opens other text formats too', async () => {
    expect(await launchTarget([join(base, 'notes', 'b.txt')], '/')).toEqual({
      root: join(base, 'notes'),
      file: 'b.txt',
    })
  })

  it('skips switches, missing paths and files it cannot show', async () => {
    const args = ['--no-sandbox', join(base, 'missing.md'), join(base, 'notes', 'c.png')]
    expect(await launchTarget(args, base)).toBeNull()
    expect(await launchTarget([], base)).toBeNull()
  })
})
