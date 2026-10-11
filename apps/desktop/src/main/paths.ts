import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export class PathEscapeError extends Error {
  constructor(path: string) {
    super(`Path is outside the project: ${path}`)
    this.name = 'PathEscapeError'
  }
}

/** True when `child` is `root` itself or lies below it. Both must be absolute and normalized. */
export function isWithin(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Resolves the deepest existing ancestor of `path` through symlinks. */
async function realpathOfExistingAncestor(path: string): Promise<string> {
  let current = path
  for (;;) {
    try {
      const real = await realpath(current)
      return resolve(real, relative(current, path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // A dangling symlink: following it later could create a file anywhere.
      if (
        await lstat(current).then(
          () => true,
          () => false,
        )
      )
        throw new PathEscapeError(path)
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

/**
 * Turns a renderer-supplied relative path into an absolute path that is guaranteed to be inside
 * `root`, including after following symlinks. Rejects absolute paths, `..` traversal and any
 * symlink (on the path or an ancestor) that leads out of the project.
 */
export async function resolveInsideRoot(root: string, relativePath: string): Promise<string> {
  if (relativePath.includes('\0') || isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) {
    throw new PathEscapeError(relativePath)
  }
  const realRoot = await realpath(root)
  const lexical = resolve(realRoot, relativePath.split('/').join(sep))
  if (lexical === realRoot || !isWithin(realRoot, lexical)) throw new PathEscapeError(relativePath)

  const real = await realpathOfExistingAncestor(lexical)
  if (!isWithin(realRoot, real) || real === realRoot) throw new PathEscapeError(relativePath)
  return real
}

/** The `/`-separated path of `absolute` relative to `root`, as the renderer sees it. */
export function toProjectPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/')
}
