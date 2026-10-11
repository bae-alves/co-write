import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { MAX_FILE_BYTES, type FileNode, type ProjectChange } from '@co-write/shared'
import { resolveInsideRoot, toProjectPath } from './paths'

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'build'])
const MAX_ENTRIES = 5_000

export const isMarkdownFile = (name: string): boolean => MARKDOWN.test(name)

/**
 * Lists Markdown files below `root`, folders first, both alphabetical. Hidden entries, build
 * folders and symlinks are skipped; folders without Markdown inside are left out.
 */
export async function listTree(root: string): Promise<FileNode[]> {
  let budget = MAX_ENTRIES
  const walk = async (dir: string): Promise<FileNode[]> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const dirs: FileNode[] = []
    const files: FileNode[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (budget-- <= 0) break
      if (entry.name.startsWith('.')) continue
      const absolute = join(dir, entry.name)
      if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) {
        const children = await walk(absolute)
        if (children.length > 0) {
          dirs.push({
            name: entry.name,
            path: toProjectPath(root, absolute),
            kind: 'dir',
            children,
          })
        }
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        files.push({ name: entry.name, path: toProjectPath(root, absolute), kind: 'file' })
      }
    }
    return [...dirs, ...files]
  }
  return walk(root)
}

export async function readProjectFile(root: string, path: string): Promise<string> {
  const absolute = await resolveInsideRoot(root, path)
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error(`Not a file: ${path}`)
  if (info.size > MAX_FILE_BYTES) throw new Error(`File too large: ${path}`)
  return readFile(absolute, 'utf8')
}

/** Writes via a temp file + rename so a crash never leaves a half-written document. */
export async function saveProjectFile(root: string, path: string, content: string): Promise<void> {
  if (!isMarkdownFile(path)) throw new Error(`Only Markdown files can be written: ${path}`)
  const absolute = await resolveInsideRoot(root, path)
  const temp = join(dirname(absolute), `.${basename(absolute)}.co-write-${randomUUID()}.tmp`)
  await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
  await rename(temp, absolute)
}

export async function createProjectFile(root: string, path: string): Promise<void> {
  if (!isMarkdownFile(path)) throw new Error(`Only Markdown files can be created: ${path}`)
  const absolute = await resolveInsideRoot(root, path)
  await mkdir(dirname(absolute), { recursive: true })
  // Re-check: mkdir may have walked through a symlinked folder created in the meantime.
  await resolveInsideRoot(root, path)
  const handle = await open(absolute, 'wx')
  await handle.close()
}

/**
 * Watches the project and reports tree changes (debounced) and changes to individual Markdown
 * files. Returns a function that stops watching.
 */
export function watchProject(root: string, onChange: (change: ProjectChange) => void): () => void {
  let timer: NodeJS.Timeout | undefined
  const changedFiles = new Set<string>()
  let watcher: FSWatcher | undefined
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (filename) {
        const path = filename.toString().split('\\').join('/')
        if (isMarkdownFile(path) && !path.split('/').some((part) => part.startsWith('.'))) {
          changedFiles.add(path)
        }
      }
      clearTimeout(timer)
      timer = setTimeout(() => {
        for (const path of changedFiles) onChange({ kind: 'file', path })
        changedFiles.clear()
        void listTree(root).then((tree) => onChange({ kind: 'tree', tree }))
      }, 150)
    })
    watcher.on('error', () => watcher?.close())
  } catch {
    // Watching is best effort (e.g. too many files for the OS); the tree can still be refreshed.
  }
  return () => {
    clearTimeout(timer)
    watcher?.close()
  }
}
