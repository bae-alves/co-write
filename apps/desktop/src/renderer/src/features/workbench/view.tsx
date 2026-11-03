import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type Layout,
  type LayoutChangedMeta,
  type PanelProps,
} from 'react-resizable-panels'
import { capabilitiesOfState, useDocument } from '@/features/document/model'
import { cn } from '@/lib/utils'
import { effectiveColumns, lockOf, workbenchIntents } from './intent'
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
  const capabilities = useDocument((s) => capabilitiesOfState(s.state))
  if (state.tag !== 'ready') return null
  const shown = effectiveColumns(state.columns, capabilities)
  return (
    <div className="flex items-center gap-0.5" role="toolbar" aria-label="Columns">
      {COLUMNS.map(({ column, label, shortcut }) => {
        const visible = shown[column]
        const lock = lockOf(state.columns, capabilities, column)
        const locked = lock !== null
        return (
          <button
            key={column}
            type="button"
            aria-pressed={visible}
            aria-disabled={locked}
            aria-label={`Toggle ${label}`}
            title={
              lock === 'unavailable'
                ? `${label} (this kind of file has none)`
                : lock === 'last'
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

/** Files column and editor area (tabs over source and preview), as percentages of the window. */
function outerLayout(columns: Columns, groupWidth: number, filesPx: number): Layout {
  const files = columns.files ? Math.min(40, (filesPx / Math.max(groupWidth, 1)) * 100) : 0
  return { files, editor: 100 - files }
}

/** Source and preview split the editor area in the ratio the user last dragged them to. */
function innerLayout(columns: Columns, sourceShare: number): Layout {
  const both = columns.source && columns.preview
  return {
    source: columns.source ? (both ? 100 * sourceShare : 100) : 0,
    preview: columns.preview ? (both ? 100 * (1 - sourceShare) : 100) : 0,
  }
}

type Slots = Record<Column, ReactNode> & { readonly tabs: ReactNode }

/**
 * The window below the toolbar, VS Code style: the file list keeps its width in pixels; the rest
 * is the editor area, tab strip on top, source and preview splitting what is below it.
 */
export function Workbench(props: Slots) {
  const state = useWorkbench((s) => s.state)
  const capabilities = useDocument((s) => capabilitiesOfState(s.state))
  const outer = useGroupRef()
  const inner = useGroupRef()
  const element = useRef<HTMLDivElement>(null)
  const filesPx = useRef(FILES_WIDTH_PX)
  const sourceShare = useRef(0.5)

  useEffect(() => {
    workbenchIntents.load()
  }, [])

  const columns = useMemo(
    () => (state.tag === 'ready' ? effectiveColumns(state.columns, capabilities) : null),
    [state, capabilities],
  )
  useLayoutEffect(() => {
    if (!columns || !outer.current || !inner.current || !element.current) return
    outer.current.setLayout(outerLayout(columns, element.current.offsetWidth, filesPx.current))
    inner.current.setLayout(innerLayout(columns, sourceShare.current))
  }, [columns, outer, inner])

  if (!columns) return null

  /** Remembers where the user dragged the file list, and hides it when dragged shut. */
  const onOuterChanged = (layout: Layout, meta: LayoutChangedMeta) => {
    if (!meta.isUserInteraction || !element.current) return
    const files = layout['files'] ?? 0
    if (files > 0) filesPx.current = (files / 100) * element.current.offsetWidth
    workbenchIntents.setVisible('files', files > 0)
  }

  /** Remembers the source/preview split, and hides a column dragged shut. */
  const onInnerChanged = (layout: Layout, meta: LayoutChangedMeta) => {
    if (!meta.isUserInteraction) return
    const source = layout['source'] ?? 0
    const preview = layout['preview'] ?? 0
    if (source > 0 && preview > 0) sourceShare.current = source / (source + preview)
    // Only columns this file has can be dragged open or shut.
    if (capabilities?.source !== false) workbenchIntents.setVisible('source', source > 0)
    if (capabilities?.preview !== false) workbenchIntents.setVisible('preview', preview > 0)
  }

  return (
    <Group
      orientation="horizontal"
      className="min-h-0 flex-1"
      groupRef={outer}
      elementRef={element}
      defaultLayout={outerLayout(columns, window.innerWidth, FILES_WIDTH_PX)}
      onLayoutChanged={onOuterChanged}
    >
      <ColumnPanel column="files" visible={columns.files}>
        {props.files}
      </ColumnPanel>
      <ResizeHandle shown={columns.files} />
      <Panel id="editor" minSize="240px" className="flex min-w-0 flex-col overflow-hidden">
        {props.tabs}
        <Group
          orientation="horizontal"
          className="min-h-0 flex-1"
          groupRef={inner}
          defaultLayout={innerLayout(columns, 0.5)}
          onLayoutChanged={onInnerChanged}
        >
          <ColumnPanel column="source" visible={columns.source}>
            {props.source}
          </ColumnPanel>
          <ResizeHandle shown={columns.source && columns.preview} />
          <ColumnPanel column="preview" visible={columns.preview}>
            {props.preview}
          </ColumnPanel>
        </Group>
      </Panel>
    </Group>
  )
}
