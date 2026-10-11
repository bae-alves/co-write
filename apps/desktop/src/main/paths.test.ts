import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isWithin, PathEscapeError, resolveInsideRoot, toProjectPath } from './paths'

let base: string
let root: string
let outside: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'co-write-paths-')))
  root = join(base, 'project')
  outside = join(base, 'outside')
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(root, 'docs', 'a.md'), '# a')
  await writeFile(join(outside, 'secret.md'), 'secret')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('resolveInsideRoot', () => {
  it('resolves files inside the project', async () => {
    expect(await resolveInsideRoot(root, 'docs/a.md')).toBe(join(root, 'docs', 'a.md'))
  })

  it('resolves paths that do not exist yet (new files)', async () => {
    expect(await resolveInsideRoot(root, 'docs/new/b.md')).toBe(join(root, 'docs', 'new', 'b.md'))
  })

  it('normalizes harmless dot segments', async () => {
    expect(await resolveInsideRoot(root, 'docs/../docs/./a.md')).toBe(join(root, 'docs', 'a.md'))
  })

  it.each([
    ['parent traversal', '../outside/secret.md'],
    ['nested traversal', 'docs/../../outside/secret.md'],
    ['absolute path', '/etc/passwd'],
    ['windows drive path', 'C:/Windows/win.ini'],
    ['the root itself', '.'],
    ['NUL byte', 'docs/a.md\0.png'],
  ])('rejects %s', async (_name, path) => {
    await expect(resolveInsideRoot(root, path)).rejects.toBeInstanceOf(PathEscapeError)
  })

  it('rejects a symlinked file that points outside', async () => {
    await symlink(join(outside, 'secret.md'), join(root, 'link.md'))
    await expect(resolveInsideRoot(root, 'link.md')).rejects.toBeInstanceOf(PathEscapeError)
  })

  it('rejects a path through a symlinked folder that points outside', async () => {
    await symlink(outside, join(root, 'escape'))
    await expect(resolveInsideRoot(root, 'escape/secret.md')).rejects.toBeInstanceOf(
      PathEscapeError,
    )
    await expect(resolveInsideRoot(root, 'escape/new.md')).rejects.toBeInstanceOf(PathEscapeError)
  })

  it('rejects a dangling symlink that would create a file outside', async () => {
    await symlink(join(outside, 'created.md'), join(root, 'dangling.md'))
    await expect(resolveInsideRoot(root, 'dangling.md')).rejects.toBeInstanceOf(PathEscapeError)
  })

  it('allows symlinks that stay inside the project and returns the real target', async () => {
    await symlink(join(root, 'docs', 'a.md'), join(root, 'alias.md'))
    expect(await resolveInsideRoot(root, 'alias.md')).toBe(join(root, 'docs', 'a.md'))
  })

  it('works when the root itself is reached through a symlink', async () => {
    const linkedRoot = join(base, 'linked-project')
    await symlink(root, linkedRoot)
    expect(await resolveInsideRoot(linkedRoot, 'docs/a.md')).toBe(join(root, 'docs', 'a.md'))
  })
})

describe('isWithin / toProjectPath', () => {
  it('treats sibling folders with a common prefix as outside', () => {
    expect(isWithin('/a/project', '/a/project-other/x')).toBe(false)
    expect(isWithin('/a/project', '/a/project/x')).toBe(true)
  })

  it('uses forward slashes for project paths', () => {
    expect(toProjectPath(root, join(root, 'docs', 'a.md'))).toBe('docs/a.md')
  })
})
