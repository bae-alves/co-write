import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type Layout,
  type LayoutChangedMeta,
  type PanelProps,
} from 'react-resizable-panels'
import { cn } from '@/lib/utils'
import { canHide, workbenchIntents } from './intent'
import { useWorkbench, type Column, type Columns } from './model'

const COLUMNS: readonly { column: Column; label: string; shortcut: string }[] = [
  { column: 'files', label: 'Files', shortcut: 'Ctrl+B' },
  { column: 'source', label: 'Source', shortcut: 'Ctrl+Shift+E' },
  { column: 'preview', label: 'Preview', shortcut: 'Ctrl+Shift+V' },
]

/** A window split in three; the column the button controls is filled while it is visible. */
function ColumnIcon({ column, visible }: { column: Column; visible: boolean }) {
  const x = column === 'files' ? 2.5 : column === 'source' ? 6.5 : 11
  const width = column === 'files' ? 4 : 4.5
  return (
    <svg viewBox="0 0 18 14" className="h-3.5 w-[18px]" aria-hidden>
      <rect x="1" y="1" width="16" height="12" rx="2" fill="none" stroke="currentColor" />
      <path d="M6.5 1v12M11 1v12" stroke="currentColor" strokeOpacity="0.45" />
      {visible && <rect x={x} y="2.5" width={width} height="9" rx="0.5" fill="currentColor" />}
    </svg>
  )
}

/** VS Code–style layout toggles for the top-left of the toolbar. */
export function ColumnToggles() {
  const state = useWorkbench((s) => s.state)
  if (state.tag !== 'ready') return null
  return (
    <div className="flex items-center gap-0.5" role="toolbar" aria-label="Columns">
      {COLUMNS.map(({ column, label, shortcut }) => {
        const visible = state.columns[column]
        const locked = visible && !canHide(state.columns, column)
        return (
          <button
            key={column}
            type="button"
            aria-pressed={visible}
            aria-disabled={locked}
            aria-label={`Toggle ${label}`}
            title={
              locked
                ? `${label} (show Source or Preview to hide this)`
                : `Toggle ${label} (${shortcut})`
            }
            onClick={() => workbenchIntents.toggle(column)}
            className={cn(
              'grid size-7 place-items-center rounded-md transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              visible ? 'text-primary' : 'text-muted-foreground hover:text-subtle-foreground',
              locked && 'cursor-default hover:bg-transparent',
            )}
          >
            <ColumnIcon column={column} visible={visible} />
          </button>
        )
      })}
    </div>
  )
}

const SIZES: Record<Column, Pick<PanelProps, 'minSize' | 'maxSize' | 'groupResizeBehavior'>> = {
  // The file list keeps its width when the window resizes; the other two share the rest.
  files: { minSize: '160px', maxSize: '40%', groupResizeBehavior: 'preserve-pixel-size' },
  source: { minSize: '240px' },
  preview: { minSize: '240px' },
}

const FILES_WIDTH_PX = 240

/**
 * One column. Hidden columns are collapsed to zero width rather than unmounted, so the editor
 * keeps its cursor and scroll position while hidden.
 */
function ColumnPanel({
  column,
  visible,
  children,
}: {
  column: Column
  visible: boolean
  children: ReactNode
}) {
  return (
    <Panel
      id={column}
      collapsible
      collapsedSize={0}
      {...SIZES[column]}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden',
        column === 'files' ? 'bg-surface' : 'bg-background',
      )}
      aria-hidden={!visible}
      inert={!visible}
    >
      {children}
    </Panel>
  )
}

function ResizeHandle({ shown }: { shown: boolean }) {
  return (
    <Separator
      disabled={!shown}
      className={cn(
        'relative w-px bg-separator transition-colors outline-none after:absolute after:inset-y-0 after:-left-1 after:w-2 data-[separator=active]:bg-primary data-[separator=hover]:bg-primary/60',
        !shown && 'hidden',
      )}
    />
  )
}

/**
 * Lays the columns out VS Code style: the file list keeps its width in pixels, source and preview
 * split the rest in the ratio the user last dragged them to.
 */
function layoutFor(
  columns: Columns,
  groupWidth: number,
  filesPx: number,
  sourceShare: number,
): Layout {
  const files = columns.files ? Math.min(40, (filesPx / Math.max(groupWidth, 1)) * 100) : 0
  const rest = 100 - files
  const both = columns.source && columns.preview
  return {
    files,
    source: columns.source ? (both ? rest * sourceShare : rest) : 0,
    preview: columns.preview ? (both ? rest * (1 - sourceShare) : rest) : 0,
  }
}

/** The three columns: files, source, preview. */
export function Workbench(props: Record<Column, ReactNode>) {
  const state = useWorkbench((s) => s.state)
  const group = useGroupRef()
  const element = useRef<HTMLDivElement>(null)
  const filesPx = useRef(FILES_WIDTH_PX)
  const sourceShare = useRef(0.5)

  useEffect(() => {
    workbenchIntents.load()
  }, [])

  const columns = state.tag === 'ready' ? state.columns : null
  useLayoutEffect(() => {
    if (!columns || !group.current || !element.current) return
    group.current.setLayout(
      layoutFor(columns, element.current.offsetWidth, filesPx.current, sourceShare.current),
    )
  }, [columns, group])

  if (!columns) return null

  /** Remembers what the user dragged to, and hides a column dragged shut. */
  const onLayoutChanged = (layout: Layout, meta: LayoutChangedMeta) => {
    if (!meta.isUserInteraction || !element.current) return
    const width = element.current.offsetWidth
    const [files = 0, source = 0, preview = 0] = [
      layout['files'],
      layout['source'],
      layout['preview'],
    ]
    if (files > 0) filesPx.current = (files / 100) * width
    if (source > 0 && preview > 0) sourceShare.current = source / (source + preview)
    workbenchIntents.setVisible('files', files > 0)
    workbenchIntents.setVisible('source', source > 0)
    workbenchIntents.setVisible('preview', preview > 0)
  }

  return (
    <Group
      orientation="horizontal"
      className="min-h-0 flex-1"
      groupRef={group}
      elementRef={element}
      defaultLayout={layoutFor(columns, window.innerWidth, FILES_WIDTH_PX, 0.5)}
      onLayoutChanged={onLayoutChanged}
    >
      <ColumnPanel column="files" visible={columns.files}>
        {props.files}
      </ColumnPanel>
      <ResizeHandle shown={columns.files && (columns.source || columns.preview)} />
      <ColumnPanel column="source" visible={columns.source}>
        {props.source}
      </ColumnPanel>
      <ResizeHandle shown={columns.source && columns.preview} />
      <ColumnPanel column="preview" visible={columns.preview}>
        {props.preview}
      </ColumnPanel>
    </Group>
  )
}
