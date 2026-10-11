import type { FileNode } from '@co-write/shared'
import { ChevronDown, ChevronRight, FilePlus, FileText, FolderOpen } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { IconButton, ListRow, SectionHeader } from '@/components/ui/section'
import { useDocument } from '@/features/document/model'
import { workbenchIntents } from '@/features/workbench/intent'
import { projectIntents } from './intent'
import { useProject } from './model'

function Tree({
  nodes,
  depth,
  collapsed,
  activePath,
}: {
  nodes: readonly FileNode[]
  depth: number
  collapsed: readonly string[]
  activePath: string | null
}) {
  return nodes.map((node) => {
    if (node.kind === 'file') {
      return (
        <ListRow
          key={node.path}
          depth={depth}
          active={node.path === activePath}
          onClick={() => void projectIntents.openFile(node.path)}
          title={node.path}
        >
          <FileText className="text-muted-foreground" />
          <span className="truncate">{node.name}</span>
        </ListRow>
      )
    }
    const open = !collapsed.includes(node.path)
    return (
      <div key={node.path} role="group" aria-label={node.name}>
        <ListRow
          depth={depth}
          aria-expanded={open}
          onClick={() => projectIntents.toggleFolder(node.path)}
        >
          {open ? <ChevronDown /> : <ChevronRight />}
          <span className="truncate">{node.name}</span>
        </ListRow>
        {open && node.children && (
          <Tree
            nodes={node.children}
            depth={depth + 1}
            collapsed={collapsed}
            activePath={activePath}
          />
        )}
      </div>
    )
  })
}

/** The local half of the files column: the open folder's Markdown files. */
export function FilesView() {
  const project = useProject((s) => s.state)
  const document = useDocument((s) => s.state)
  const activePath = 'ref' in document && document.ref.kind === 'local' ? document.ref.path : null

  useEffect(() => {
    void projectIntents.restore()
    return projectIntents.listen()
  }, [])

  return (
    <section aria-label="Files" className="flex min-h-0 flex-1 flex-col">
      <SectionHeader title={project.tag === 'open' ? project.name : 'Files'}>
        {project.tag === 'open' && (
          <IconButton label="New file" onClick={() => workbenchIntents.openDialog('new-file')}>
            <FilePlus />
          </IconButton>
        )}
        <IconButton
          label="Open folder"
          disabled={project.tag === 'opening'}
          onClick={() => void projectIntents.openFolder()}
        >
          <FolderOpen />
        </IconButton>
      </SectionHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {project.tag === 'open' ? (
          project.tree.length > 0 ? (
            <Tree
              nodes={project.tree}
              depth={0}
              collapsed={project.collapsed}
              activePath={activePath}
            />
          ) : (
            <p className="px-3 py-2 text-xs text-muted-foreground">No Markdown files here yet.</p>
          )
        ) : (
          <div className="flex flex-col items-start gap-2 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              {project.tag === 'opening' ? 'Opening…' : 'No folder open.'}
            </p>
            {project.tag === 'none' && (
              <Button size="sm" variant="outline" onClick={() => void projectIntents.openFolder()}>
                <FolderOpen className="size-3.5" /> Open folder
              </Button>
            )}
            {project.tag === 'none' && project.error && (
              <p role="alert" className="text-xs text-destructive">
                {project.error}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
